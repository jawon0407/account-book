import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { FastifyInstance } from "fastify";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RESPONSE_REQUEST_ID = Symbol("responseRequestId");

type CorrelatedRequest = import("fastify").FastifyRequest & {
  [RESPONSE_REQUEST_ID]?: string;
};

/**
 * 소문자 UUID 형식의 추적 ID만 유지하고 나머지는 새 서버 UUID로 바꾼다.
 * @param value - 검증된 사용자 정보 또는 서버 요청에서 얻은 ID 후보.
 * @returns 응답에 안전하게 사용할 UUID 문자열. 필요하면 난수를 생성한다.
 */
function safeRequestId(value: unknown): string {
  return typeof value === "string" && CANONICAL_UUID.test(value) ? value : randomUUID();
}

/**
 * 응답 추적 ID를 한 번 고른 뒤 요청 객체에 보관해 필터와 응답 훅이 같은 값을 쓰게 한다.
 * @param request - 검증된 principal 또는 서버 생성 ID를 가진 Fastify 요청.
 * @returns 이전에 고른 ID 또는 형식을 검사해 새로 고른 ID. 입력 헤더는 직접 읽지 않는다.
 * @remarks 요청 객체의 비공개 Symbol 속성에 선택한 값을 저장한다.
 */
export function responseRequestId(request: CorrelatedRequest): string {
  const existing = request[RESPONSE_REQUEST_ID];
  if (existing !== undefined) return existing;
  const selected = safeRequestId(request.principal?.requestId ?? request.id);
  request[RESPONSE_REQUEST_ID] = selected;
  return selected;
}

/**
 * 서버가 직접 UUID를 생성하고 자동 요청 로그를 끈 Fastify 어댑터를 만든다.
 * @returns 입력 요청 ID 헤더를 신뢰하지 않는 새 어댑터. 이 함수만으로 포트를 열지는 않는다.
 */
export function createApiFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    /** @returns 요청마다 새로 생성한 서버 소유 UUID. 외부 헤더값은 읽지 않는다. */
    genReqId: () => randomUUID(),
    logger: false,
    requestIdHeader: false,
  });
}

/**
 * 응답을 전송하기 직전 실행되는 onSend 훅에서 X-Request-Id 헤더를 설정한다.
 * @param server - Nest 애플리케이션이 소유한 Fastify 서버.
 * @returns 반환값 없음. 서버에 응답 훅을 추가한다.
 */
export function registerRequestContext(server: FastifyInstance): void {
  // 훅은 request에서 추적 ID를 고르고 reply 헤더를 바꾼 뒤 done으로 전송 흐름을 재개한다.
  server.addHook("onSend", (request, reply, _payload, done) => {
    // principal은 가드의 검증과 재사용 차단이 모두 끝난 뒤에만 사용할 수 있다.
    reply.header("X-Request-Id", responseRequestId(request));
    done();
  });
}
