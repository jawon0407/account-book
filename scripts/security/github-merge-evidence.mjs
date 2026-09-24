import { SecurityGateError } from "./errors.mjs";
import { assertMainContextShape, assertPullRequestShape, assertPullRequestEvidence,
  mergeEvidenceError } from "./merge-evidence.mjs";

const MAX_BYTES = 1024 * 1024;
const unavailable = () => mergeEvidenceError("MAIN_MERGE_EVIDENCE_UNAVAILABLE");

/**
 * Link 헤더의 관계만 읽어 다음 페이지 존재 여부를 반환한다. URL은 호출하지 않는다.
 * @param {string|null} link API 페이지 헤더. 잘못되거나 중복된 관계는 확인 불가 오류.
 * @returns {boolean} 명시된 next 관계 유무.
 */
function hasNextPage(link) {
  if (link === null) return false;
  const relations = new Set();
  for (const item of link.split(",")) {
    const match = /^\s*<https:\/\/[^<>\s]+>;\s*rel="(next|prev|first|last)"\s*$/u.exec(item);
    if (!match || relations.has(match[1])) throw unavailable();
    relations.add(match[1]);
  }
  return relations.has("next");
}

/**
 * 응답 본문을 실제 바이트로 제한해 JSON을 읽고 실패·취소 시 스트림을 정리한다.
 * @param {Response} response GET 응답. 오류 원문을 밖으로 전달하지 않는다.
 * @param {AbortSignal} signal 전체 조회에서 공유하는 제한 시간 신호.
 * @returns {Promise<unknown>} 해석한 JSON. 1MiB 초과/읽기 실패면 오류.
 */
async function readBoundedJson(response, signal) {
  let reader;
  const cancel = () => {
    // 취소를 무시하는 대역도 전체 deadline이 종료시킨다. 늦은 거절은 관찰한다.
    Promise.resolve(reader ? reader.cancel() : response.body?.cancel()).catch(() => {});
  };
  try {
    signal.throwIfAborted();
    if (response.status !== 200 || !response.body) throw unavailable();
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > MAX_BYTES)) throw unavailable();
    reader = response.body.getReader();
    signal.addEventListener("abort", cancel, { once: true });
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw unavailable();
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    cancel(); throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
}

/**
 * 고정 GitHub API에서 최대 3페이지와 PR 상세를 재조회해 증빙 쌍을 반환한다.
 * @param {{repository:string,repositoryId:number,before:string,after:string}} context 검증 대상 이벤트.
 * @param {{token:string,fetcher?:typeof fetch,timeoutMs?:number}} options 읽기 토큰/HTTP 대역/전체 제한 시간(최대 10초).
 * @returns {Promise<{candidate:object,pullRequest:object}>} 토큰 없는 증빙. 정책 불일치 또는 확인 불가 시 고정 오류.
 */
export async function loadGithubMergeEvidence(context, { token, fetcher = globalThis.fetch, timeoutMs = 10000 }) {
  assertMainContextShape(context, "MAIN_PUSH_CONTEXT_INVALID");
  if (typeof token !== "string" || !/^[\x21-\x7e]+$/u.test(token) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw unavailable();
  const controller = new AbortController();
  const { signal } = controller;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
  });
  const root = `https://api.github.com/repos/${context.repository.split("/").map(encodeURIComponent).join("/")}`;
  /** path는 내부 고정 경로다. 동일 signal로 GET 후 제한된 본문과 헤더를 반환한다. */
  async function get(path) {
    signal.throwIfAborted();
    const response = await fetcher(`${root}${path}`, { method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10" } });
    signal.throwIfAborted();
    const data = await readBoundedJson(response, signal);
    signal.throwIfAborted();
    return { data, link: response.headers.get("link") };
  }
  /** 전체 페이지를 끝까지 검사한 뒤 하나의 후보만 상세 확인하는 내부 작업이다. */
  async function collect() {
    const candidates = [], ids = new Set(), numbers = new Set();
    for (let page = 1; page <= 3; page++) {
      const { data, link } = await get(`/commits/${encodeURIComponent(context.after)}/pulls?per_page=100&page=${page}`);
      if (!Array.isArray(data) || data.length > 100) throw unavailable();
      for (const pr of data) {
        assertPullRequestShape(pr);
        if (ids.has(pr.id) || numbers.has(pr.number)) throw unavailable();
        ids.add(pr.id); numbers.add(pr.number);
        if (pr.state === "closed" && pr.merged_at !== null &&
          pr.merge_commit_sha?.toLowerCase() === context.after.toLowerCase()) candidates.push(pr);
      }
      if (!hasNextPage(link)) break;
      if (page === 3) throw unavailable();
    }
    if (candidates.length !== 1) throw mergeEvidenceError("MAIN_MERGE_EVIDENCE_REJECTED");
    const candidate = candidates[0];
    const { data: pullRequest } = await get(`/pulls/${candidate.number}`);
    assertPullRequestEvidence(context, candidate, pullRequest);
    return { candidate, pullRequest };
  }
  try {
    return await Promise.race([collect(), deadline]);
  } catch (error) {
    controller.abort();
    if (error instanceof SecurityGateError && error.code === "MAIN_MERGE_EVIDENCE_REJECTED") throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
  }
}
