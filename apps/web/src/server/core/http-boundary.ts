import { ApiErrorSchema, buildApiError, type ApiErrorCode } from "@account-book/contracts";

/** 공개 가능한 코드와 HTTP 상태만 보관하며 내부 예외·입력 원문은 저장하지 않는다. */
export class CoreBoundaryError extends Error {
  /** @param code 공개 코드. @param status HTTP 상태. */
  public constructor(public readonly code: ApiErrorCode, public readonly status: number) { super(code); }
}

/** @param body 검증된 공개 데이터. @param status HTTP 상태. @returns 상류 헤더를 복사하지 않는 캐시 금지 JSON. */
export function coreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", Pragma: "no-cache", Expires: "0", "X-Content-Type-Options": "nosniff" } });
}

/** @param code 공개 코드. @param status HTTP 상태. @param retryable 자동 재전송이 아닌 UI 안내용 힌트. */
export function coreFailure(code: ApiErrorCode, status: number, retryable = false): Response {
  return coreJson(buildApiError({ code, retryable }), status);
}

/**
 * 메모리·대기 시간 한도를 적용한 뒤 UTF-8 JSON을 읽는다. 거부된 스트림은 취소한다.
 * @param source Request 또는 Response. @param limit 최대 바이트(문자 수가 아님).
 * @throws 원문을 담지 않는 고정 오류. 호출자가 입력 400/상류 502로 구분한다.
 */
export async function boundedJson(source: Request | Response, limit: number): Promise<unknown> {
  const reader = source.body?.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!reader || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(source.headers.get("content-type") ?? "")) throw new Error("INVALID_JSON");
    const length = source.headers.get("content-length");
    // fetch는 압축 해제한 바이트를 돌려주면서 압축 전송 길이 헤더는 유지한다.
    const decodedResponse = source instanceof Response && ![null, "identity"].includes(source.headers.get("content-encoding")?.toLowerCase() ?? null);
    if (length !== null && (!/^(0|[1-9]\d*)$/u.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit)) throw new Error("INVALID_JSON");
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("JSON_TIMEOUT")), 3_000); });
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (!finished) {
      const chunk = await Promise.race([reader.read(), deadline]);
      finished = chunk.done;
      if (!chunk.done) {
        total += chunk.value.byteLength;
        if (total > limit) throw new Error("INVALID_JSON");
        chunks.push(chunk.value);
      }
    }
    if (!decodedResponse && length !== null && Number(length) !== total) throw new Error("INVALID_JSON");
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // cancel 자체가 응답을 지연시키지 않게 기다리지 않는다. 거부도 관찰하여 unhandled rejection을 막는다.
    if (reader && !finished) void reader.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

const ERROR_STATUS: Partial<Record<ApiErrorCode, number>> = {
  PROFILE_VALIDATION_FAILED: 400, LEDGER_VALIDATION_FAILED: 400,
  AUTH_SESSION_EXPIRED: 401, AUTH_RATE_LIMITED: 429,
  LEDGER_NOT_FOUND: 404, PROFILE_VERSION_CONFLICT: 409, LEDGER_VERSION_CONFLICT: 409,
  LEDGER_IDEMPOTENCY_CONFLICT: 409, LEDGER_ACCOUNT_UNAVAILABLE: 409, LEDGER_CATEGORY_UNAVAILABLE: 409,
  LEDGER_SERVICE_UNAVAILABLE: 503, AUTH_PROVIDER_UNAVAILABLE: 503,
};

/** @param input 상류 오류 JSON. @param status 실제 HTTP 상태. @param read 조회 요청인지 여부. @returns 검증된 고정 오류만 재구성한다. */
export function upstreamFailure(input: unknown, status: number, read: boolean): Response {
  const error = ApiErrorSchema.parse(input);
  if (ERROR_STATUS[error.code] !== status) throw new Error("INVALID_UPSTREAM_ERROR");
  return coreJson(buildApiError({ ...error, retryable: read && status === 503 }), status);
}
