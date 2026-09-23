import { ApiErrorSchema, PublicErrorMessages } from "@account-book/contracts";
import { HttpException, type ArgumentsHost } from "@nestjs/common";
import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AccessTokenVerificationUnavailableError, InvalidAccessTokenError } from "../auth/jwt-verifier.js";
import { ApiErrorFilter } from "./api-error.filter.js";
import { registerRequestContext } from "./request-context.js";

/**
 * 응답 대역에 오류 필터를 실행해 상태·본문·헤더를 관찰한다.
 * @param exception - 필터에 넘길 예외 후보.
 * @param requestId - 서버 요청 ID 후보.
 * @param principal - 검증된 사용자 정보가 있다고 가정할 선택적 추적 ID.
 * @returns 필터가 기록한 응답값과 헤더.
 */
function run(exception: unknown, requestId = "unsafe\r\ninbound", principal?: { requestId: string }) {
  const headers = new Map<string, string>();
  let status = 0;
  let body: unknown;
  const reply = {
    /** 헤더를 소문자 키로 기록한다. @param name - 헤더명. @param value - 헤더값. */
    header(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
    /** 상태 코드를 관찰용 변수에 기록한다. @param value - 응답 상태 코드. */
    status(value: number) { status = value; return this; },
    /** 본문을 관찰용 변수에 기록한다. @param value - 필터가 보낸 응답값. */
    send(value: unknown) { body = value; return this; },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId, principal, headers: { authorization: "Bearer response-secret" } }),
      getResponse: () => reply,
    }),
  } as unknown as ArgumentsHost;

  new ApiErrorFilter().catch(exception, host);
  return { /** @returns 응답 대역의 send가 마지막으로 받은 본문. */ get body() { return body; }, /** @returns 응답 대역의 status가 마지막으로 받은 상태 코드. */ get status() { return status; }, headers };
}

/**
 * 스키마 파싱 전에 오류 응답 원문이 고정 정책과 일치하는지 단언한다.
 * @param response - 응답 대역이 수집한 결과.
 * @param code - 기대한 공개 오류 코드.
 * @param retryable - 기대한 재시도 가능 여부.
 * @returns 반환값 없음. 불일치는 테스트 실패로 보고한다.
 */
function assertRawEnvelope(response: ReturnType<typeof run>, code: keyof typeof PublicErrorMessages, retryable: boolean): void {
  const body = response.body as { code: string; message: string; requestId: string; retryable: boolean; fieldErrors: unknown[] };
  expect(body.code).toBe(code);
  expect(body.message).toBe(PublicErrorMessages[code]);
  expect(body.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  expect(body.retryable).toBe(retryable);
  expect(body.fieldErrors).toEqual([]);
  expect(response.headers.get("x-request-id")).toBe(body.requestId);
}
describe("ApiErrorFilter", () => {
  it("maps authentication failures to one no-store shared envelope", () => {
    const response = run(new InvalidAccessTokenError());
    assertRawEnvelope(response, "AUTH_SESSION_EXPIRED", false);
    const parsed = ApiErrorSchema.parse(response.body);

    expect(response.status).toBe(401);
    expect(parsed).toMatchObject({ code: "AUTH_SESSION_EXPIRED", retryable: false, fieldErrors: [] });
    expect(parsed.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe(parsed.requestId);
  });

  it("maps Nest's exact Fastify body-limit wrapper to an empty public 413", () => {
    const response = run(new HttpException("Request body is too large", 413));

    expect(response.status).toBe(413);
    expect(response.body).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it.each([
    ["an arbitrary statusCode", Object.assign(new Error("forged-status-detail"), { statusCode: 413 })],
    [
      "forged matching fields on the wrong constructor",
      Object.assign(new RangeError("forged-fastify-detail"), {
        name: "FastifyError",
        code: "FST_ERR_CTP_BODY_TOO_LARGE",
        statusCode: 413,
      }),
    ],
    ["a different 413 HttpException", new HttpException("forged-http-detail", 413)],
    [
      "a body-limit wrapper carrying an internal cause",
      Object.assign(new HttpException("Request body is too large", 413), {
        cause: new Error("forged-cause-detail"),
      }),
    ],
  ])("fails closed on %s instead of trusting 413-like fields", (_name, exception) => {
    const response = run(exception);

    expect(response.status).toBe(503);
    assertRawEnvelope(response, "AUTH_PROVIDER_UNAVAILABLE", true);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/forged-status-detail|forged-fastify-detail|forged-http-detail|forged-cause-detail/iu);

    expect(ApiErrorSchema.parse(response.body)).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true, fieldErrors: [] });
  });
  it("fails closed on unexpected errors without leaking exception or request data", () => {
    const response = run(new Error("provider-message?token=exception-secret"));
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true, fieldErrors: [] });
    expect(serialized).not.toMatch(/provider-message|exception-secret|response-secret|unsafe|inbound/iu);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("uses a verified principal correlation ID and maps unavailable verification to a fixed 503", () => {
    const verifiedId = "123e4567-e89b-12d3-a456-426614174002";
    const response = run(new AccessTokenVerificationUnavailableError(), "123e4567-e89b-12d3-a456-426614174003", { requestId: verifiedId });
    assertRawEnvelope(response, "AUTH_PROVIDER_UNAVAILABLE", true);
    const parsed = ApiErrorSchema.parse(response.body);

    expect(response.status).toBe(503);
    expect(parsed).toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: true, requestId: verifiedId });
    expect(response.headers.get("x-request-id")).toBe(verifiedId);
  });

  it("preserves the error envelope fallback ID when onSend runs after a malformed internal candidate", () => {
    let hook: ((request: never, reply: never, payload: unknown, done: () => void) => void) | undefined;
    const server = { addHook: vi.fn((_name: string, value: typeof hook) => { hook = value; }) } as unknown as FastifyInstance;
    const headers = new Map<string, string>();
    let body: unknown;
    const request = { id: "unsafe", principal: { requestId: "also-unsafe" } };
    const reply = {
      /** 응답 훅이 덮어쓴 헤더도 관찰한다. @param name - 헤더명. @param value - 값. */
      header(name: string, value: string) { headers.set(name.toLowerCase(), value); return this; },
      /** 이 테스트는 상태가 아닌 추적 ID만 보므로 체이닝만 유지한다. @returns 같은 응답 대역. */
      status() { return this; },
      /** 추적 ID 비교를 위해 오류 본문을 저장한다. @param value - 오류 응답. */
      send(value: unknown) { body = value; return this; },
    };
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
    } as unknown as ArgumentsHost;

    new ApiErrorFilter().catch(new InvalidAccessTokenError(), host);
    registerRequestContext(server);
    hook!(request as never, reply as never, undefined, () => undefined);

    const rawBody = body as { code: string; message: string; requestId: string; retryable: boolean; fieldErrors: unknown[] };
    expect(rawBody.code).toBe("AUTH_SESSION_EXPIRED");
    expect(rawBody.message).toBe(PublicErrorMessages.AUTH_SESSION_EXPIRED);
    expect(rawBody.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    expect(rawBody.retryable).toBe(false);
    expect(rawBody.fieldErrors).toEqual([]);
    expect(headers.get("x-request-id")).toBe(rawBody.requestId);

    const parsed = ApiErrorSchema.parse(body);
    expect(headers.get("x-request-id")).toBe(parsed.requestId);
  });
});
