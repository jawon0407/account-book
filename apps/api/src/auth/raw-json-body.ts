import { DELEGATED_JSON_BODY_MAX_BYTES } from "@account-book/contracts/internal-api";
import type { FastifyInstance } from "fastify";

/**
 * 파서가 입력 내용을 노출하지 않고 사용할 고정 오류를 만든다.
 * @returns statusCode 400 속성을 가진 오류 객체. 실제 HTTP 응답은 오류 처리 경계가 결정한다.
 */
function invalidRequestError(): Error & { statusCode: number } {
  return Object.assign(new Error("DELEGATED_REQUEST_INVALID"), { statusCode: 400 });
}

/**
 * Fastify의 JSON 파서를 교체해 UTF-8·JSON 검증 후 원문 바이트도 request.rawBody에 보존한다.
 * 본문을 다시 직렬화하면 서명 대상 바이트가 달라질 수 있어 파싱 결과와 원문을 따로 보관한다.
 * @param server - 경로 초기화 전에 한 번 구성할 Nest 소유 Fastify 서버.
 * @returns 반환값 없음. 기존 JSON 파서를 제거하고 크기 제한을 둔 파서를 등록한다.
 * @remarks 본문 해석 실패는 파서 콜백의 done으로 전달하며 원문을 응답하거나 기록하지 않는다.
 */
export function registerRawJsonBody(server: FastifyInstance): void {
  server.removeContentTypeParser("application/json");
  server.addContentTypeParser(
    "application/json",
    {
      // Buffer parsing preserves the request bytes that will be verified.
      parseAs: "buffer",
      // Reject oversized bodies before retaining them in memory.
      bodyLimit: DELEGATED_JSON_BODY_MAX_BYTES,
    },
    /**
     * UTF-8를 엄격하게 해석하고 JSON 파싱이 성공한 경우에만 원문을 검증용으로 보관한다.
     * @param request - rawBody를 저장할 현재 요청.
     * @param body - Fastify가 크기 제한을 적용해 수집한 본문 Buffer.
     * @param done - 오류 또는 파싱 결과를 Fastify에 전달하는 완료 콜백.
     * @returns 직접 반환할 데이터는 없으며 성공·실패 모두 done으로 알린다.
     */
    (request, body, done) => {
      try {
        if (!Buffer.isBuffer(body)) return done(invalidRequestError());
        const bytes = new Uint8Array(body);
        // Fatal decoding rejects malformed UTF-8 instead of replacing its bytes.
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const parsed = JSON.parse(text) as unknown;
        // Retained only for verification; controllers must not log or return rawBody.
        request.rawBody = bytes;
        done(null, parsed);
      } catch {
        done(invalidRequestError());
      }
    },
  );
}
