import { ApiErrorSchema, buildApiError, type ApiError } from "@account-book/contracts";
import ky from "ky";

// 브라우저 요청은 /api BFF로 모은다. 같은 출처 쿠키를 보내고 10초 제한·자동 재시도 0회를 적용한다.
export const apiClient = ky.create({
  prefix: "/api",
  credentials: "same-origin",
  retry: { limit: 0 },
  timeout: 10_000,
  headers: { accept: "application/json" },
});

/** 주입 가능한 HTTP 구현이 제공할 최소 JSON 응답 인터페이스다. */
export type JsonResult = Readonly<{ json<T = unknown>(): Promise<T> }>;

/** 인증 query가 사용하는 상대 경로 GET/POST 인터페이스. 테스트에서는 네트워크 대신 대역을 넣는다. */
export type BrowserApiClient = Readonly<{
  get(path: string): JsonResult;
  post(path: string, options: Readonly<{ json: unknown; headers: Readonly<Record<string, string>> }>): JsonResult;
}>;

/** 원본 예외나 응답 전체 대신 공개 오류 계약만 보관하는 UI용 오류다. */
export class ApiClientError extends Error {
  /**
   * 공개 오류 정보만 Error 객체에 보관한다. 이 생성자 자체는 스키마 검증을 하지 않는다.
   * @param envelope - 호출자가 미리 검증한 ApiError. message/code/retryable 등을 포함한다.
   * @returns 새 ApiClientError 인스턴스. 원본 네트워크 예외를 보관하지 않는다.
   */
  public constructor(public readonly envelope: ApiError) {
    super(envelope.message);
    this.name = "ApiClientError";
  }

  /** @returns UI 분기에 사용할 공개 오류 코드. 상태 변경 없이 envelope에서 읽는다. */
  public get code(): ApiError["code"] { return this.envelope.code; }
  /** @returns 서버가 공개한 재시도 가능 여부. 이 값 자체로 재시도를 실행하지 않는다. */
  public get retryable(): boolean { return this.envelope.retryable; }
}

/**
 * 알 수 없는 HTTP 실패를 UI가 사용할 공개 오류 계약으로 변환한다.
 * 기존 ApiClientError, ky의 data, 복제한 Response JSON 순서로 확인하고 형식이 맞지 않으면 고정 오류를 만든다.
 * @param error - catch로 받은 임의 값. ky 2의 data나 response를 가질 수 있다.
 * @returns ApiClientError Promise. 정상적인 형식 불일치는 AUTH_PROVIDER_UNAVAILABLE로 변환한다.
 * @remarks 응답 원본은 소비하지 않는다. 이미 ApiClientError이면 재검증 없이 반환하며, response 속성 읽기 예외는 별도 보호하지 않는다.
 */
export async function apiError(error: unknown): Promise<ApiClientError> {
  if (error instanceof ApiClientError) return error;
  if (error !== null && typeof error === "object") {
    try {
      const parsed = ApiErrorSchema.safeParse((error as { data?: unknown }).data);
      if (parsed.success) return new ApiClientError(parsed.data);
    } catch {
      // 신뢰할 수 없는 data 속성을 읽지 못하면 Response 검사로 넘어간다.
    }
  }
  const response = error !== null && typeof error === "object" ? (error as { response?: unknown }).response : undefined;
  if (response instanceof Response) {
    try {
      const parsed = ApiErrorSchema.safeParse(await response.clone().json());
      if (parsed.success) return new ApiClientError(parsed.data);
    } catch {
      // 응답 JSON을 읽거나 검증할 수 없으면 고정 공개 오류를 사용한다.
    }
  }
  return new ApiClientError(buildApiError({ code: "AUTH_PROVIDER_UNAVAILABLE", retryable: false, fieldErrors: [] }));
}
