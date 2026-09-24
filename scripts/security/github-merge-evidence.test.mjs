import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { loadGithubMergeEvidence } from "./github-merge-evidence.mjs";
import { mainFixture } from "./merge-evidence.test-fixtures.mjs";

const token = "synthetic-test-token";
const unavailable = { code: "MAIN_MERGE_EVIDENCE_UNAVAILABLE", message: "GitHub merge evidence could not be verified." };
const rejected = { code: "MAIN_MERGE_EVIDENCE_REJECTED" };
const next = '<https://untrusted.invalid/path>; rel="next"';
function load(responses, options = {}) {
  const calls = [];
  const promise = loadGithubMergeEvidence(mainFixture().context, { token,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }, ...options });
  return { calls, promise };
}
test("loads list and detail only from the fixed host using bounded authenticated GET", async () => {
  const f = mainFixture();
  const { promise, calls } = load([Response.json([f.candidate]), Response.json(f.pullRequest)]);
  const result = await promise;
  assert.deepEqual(result, { candidate: f.candidate, pullRequest: f.pullRequest });
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/commits\/2{40}\/pulls\?per_page=100&page=1$/u);
  assert.match(calls[1].url, /\/pulls\/12$/u);
  for (const { url, init } of calls) {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.equal(init.headers.Accept, "application/vnd.github+json");
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].init.signal, calls[1].init.signal);
  assert.ok(!JSON.stringify(result).includes(token));
});
for (const status of [401, 403, 404, 429, 500, 302]) {
  test(`fails closed on HTTP ${status} without retry or raw diagnostics`, async () => {
    const { promise, calls } = load([new Response(`raw-${token}`, { status })]);
    await assert.rejects(promise, unavailable); assert.equal(calls.length, 1);
  });
}
for (const [label, response] of [
  ["fetch exception", () => new Error(`raw-${token}`)],
  ["null body", () => new Response(null)],
  ["invalid JSON", () => new Response(`raw-${token}`)],
  ["object list", () => Response.json({})],
  ["malformed entry", () => Response.json([{ id: 12 }])],
  ["too many entries", () => Response.json(Array(101).fill(mainFixture().candidate))],
  ["declared oversized body", () => new Response("[]", { headers: { "content-length": "1048577" } })],
  ["actual oversized body", () => new Response(" ".repeat(1048577))],
  ["lying size header", () => new Response(" ".repeat(1048577), { headers: { "content-length": "2" } })],
  ["broken stream", () => new Response(new ReadableStream({ start(c) { c.error(new Error(token)); } }))],
  ["invalid Link", () => Response.json([], { headers: { Link: "not a link" } })],
  ["duplicate next relation", () => Response.json([], { headers: { Link: `${next}, ${next}` } })],
]) {
  test(`rejects ${label}`, async () => {
    const { promise, calls } = load([response()]);
    await assert.rejects(promise, unavailable); assert.equal(calls.length, 1);
  });
}
for (const count of [2, 3]) {
  test(`reads all ${count} pages before detail and never follows Link URLs`, async () => {
    const f = mainFixture();
    const pages = Array.from({ length: count }, (_, i) => Response.json(i === 0 ? [f.candidate] : [],
      { headers: i < count - 1 ? { Link: next } : {} }));
    const { promise, calls } = load([...pages, Response.json(f.pullRequest)]);
    assert.equal((await promise).pullRequest.number, 12);
    assert.equal(calls.length, count + 1);
    for (let i = 0; i < count; i++) assert.ok(calls[i].url.endsWith(`&page=${i + 1}`));
  });
}
test("first-page match cannot bypass a later duplicate or fourth page", async () => {
  const f = mainFixture();
  const duplicate = load([Response.json([f.candidate], { headers: { Link: next } }), Response.json([f.candidate])]);
  await assert.rejects(duplicate.promise, unavailable); assert.equal(duplicate.calls.length, 2);
  const overflow = load(Array.from({ length: 3 }, () => Response.json([], { headers: { Link: next } })));
  await assert.rejects(overflow.promise, unavailable); assert.equal(overflow.calls.length, 3);
});
test("zero or multiple matching candidates are rejected without detail calls", async () => {
  const f = mainFixture();
  for (const list of [[], [f.candidate, { ...f.candidate, id: 121, number: 13 }]]) {
    const { promise, calls } = load([Response.json(list)]);
    await assert.rejects(promise, rejected); assert.equal(calls.length, 1);
  }
});
test("unmerged test SHA never authorizes an update", async () => {
  const f = mainFixture(); f.candidate.merged_at = null; f.candidate.state = "open";
  await assert.rejects(load([Response.json([f.candidate])]).promise, rejected);
});
for (const [label, mutate, want] of [
  ["array detail", () => [], unavailable],
  ["unmerged detail", f => ({ ...f.pullRequest, merged: false }), rejected],
  ["changed identity", f => ({ ...f.pullRequest, id: 121 }), rejected],
  ["changed result", f => ({ ...f.pullRequest, merge_commit_sha: "4".repeat(40) }), rejected],
  ["missing merged", f => { delete f.pullRequest.merged; return f.pullRequest; }, unavailable],
]) {
  test(`rejects ${label} between list and detail`, async () => {
    const f = mainFixture();
    await assert.rejects(load([Response.json([f.candidate]), Response.json(mutate(f))]).promise, want);
  });
}
test("invalid token, timeout or repository fails before sending any request", async () => {
  for (const options of [{ token: undefined }, { token: "" }, { token: "line\nbreak" },
    { timeoutMs: 0 }, { timeoutMs: 10001 }, { timeoutMs: NaN }]) {
    const { promise, calls } = load([], options);
    await assert.rejects(promise, unavailable); assert.equal(calls.length, 0);
  }
  let called = false;
  await assert.rejects(loadGithubMergeEvidence({ ...mainFixture().context, repository: "../bad" }, {
    token, fetcher: () => { called = true; },
  }), { code: "MAIN_PUSH_CONTEXT_INVALID" });
  assert.equal(called, false);
});
test("unsettled fetch and body are bounded even when abort is ignored", { timeout: 1500 }, async () => {
  for (const fetcher of [() => new Promise(() => {}),
    async () => new Response(new ReadableStream({ pull: () => new Promise(() => {}) }))]) {
    await assert.rejects(loadGithubMergeEvidence(mainFixture().context, { token, fetcher, timeoutMs: 20 }), unavailable);
  }
});
test("deadline aborts stream and late responses never trigger detail fetches", { timeout: 1500 }, async () => {
  for (const mode of ["resolve", "reject", "body"]) {
    let calls = 0, signal, finish, cancelled = false;
    const work = loadGithubMergeEvidence(mainFixture().context, { token, timeoutMs: 20,
      fetcher: async (_url, init) => {
        calls++; signal = init.signal;
        if (mode === "body") return new Response(new ReadableStream({
          start(c) { finish = () => { if (!cancelled) { c.enqueue(new TextEncoder().encode("[]")); c.close(); } }; },
          cancel() { cancelled = true; },
        }));
        return new Promise((resolve, reject) => { finish = () => mode === "resolve"
          ? resolve(Response.json([mainFixture().candidate])) : reject(new Error(token)); });
      } });
    await assert.rejects(work, unavailable);
    assert.equal(signal.aborted, true); finish(); await delay(30);
    assert.equal(calls, 1);
    if (mode === "body") assert.equal(cancelled, true);
  }
});
