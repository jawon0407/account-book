import "server-only";

import { rethrowProviderError } from "./error-mapper.js";
import { createProviderDeadline, type ProviderDeadline } from "./provider-request-deadline.js";

export type ProviderOperation = Readonly<{
  /** 응답 본문까지 작업 시간 안에서 읽고 원시 전송 오류를 숨기는 제공자 전송 함수입니다. */
  fetch: typeof fetch;
  /** @returns 작업이 활성 상태이면 값 없이 종료합니다. @throws 만료·취소 뒤에는 고정 AuthProviderError. */
  assertActive(): void;
}>;

/**
 * SDK 내부에 안전하게 전달할 고정 가용성 실패 응답을 만듭니다.
 * @returns 원시 전송 오류나 민감값을 포함하지 않는 408 JSON 응답.
 */
function unavailableResponse(): Response {
  return new Response('{"message":"AUTH_PROVIDER_UNAVAILABLE"}', {
    status: 408,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 읽은 본문의 JSON 구문을 SDK보다 먼저 확인해 파싱 오류에 원문이 섞이지 않게 합니다.
 * @param response 제공자가 반환한 상태와 헤더.
 * @param bytes 같은 작업 예산 안에서 읽은 원본 바이트.
 * @returns 유효한 JSON/무본문 응답은 그대로 재구성하고, 잘못된 429는 고정 제한 응답을 반환합니다.
 * @throws 나머지 잘못된 JSON은 원문 없는 오류를 던져 호출자가 작업을 실패 처리하게 합니다.
 * 취소 책임: 자체 타이머나 신호를 만들지 않으며 호출자가 디코딩 뒤 마감 검사와 정리를 담당합니다.
 */
function bufferedResponse(response: Response, bytes: ArrayBuffer): Response {
  const bodyless = [204, 205, 304].includes(response.status);
  // 성공한 빈 logout은 SDK의 noResolveJson 경로이므로 JSON 본문을 요구하지 않습니다.
  if (!bodyless && (bytes.byteLength > 0 || !response.ok)) {
    try {
      JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      if (response.status === 429) {
        return new Response('{"message":"AUTH_RATE_LIMITED"}', {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("AUTH_PROVIDER_UNAVAILABLE");
    }
  }
  return new Response(bodyless ? null : bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * 헤더와 본문 읽기를 같은 작업 시간 안에 끝내는 전송 함수를 만듭니다.
 * @param fetcher 실제 제공자 HTTP 전송 함수.
 * @param deadline 작업 전체가 공유하는 시간 제한과 내부 취소 신호.
 * @returns 호출자 신호를 감시하되 실제 전송에는 내부 신호를 주입하는 fetch 함수.
 * 취소 책임: 호출자 신호는 변경하지 않고 리스너를 제거하며, 늦게 도착한 응답 본문을 취소합니다.
 */
function guardedFetch(fetcher: typeof fetch, deadline: ProviderDeadline): typeof fetch {
  return async (input, init) => {
    const external = init?.signal === undefined
      ? (input instanceof Request ? input.signal : undefined)
      : init.signal;
    /** 호출자 취소를 작업 실패로 전환하되 호출자 컨트롤러는 변경하지 않습니다. */
    const onAbort = (): void => deadline.fail();
    external?.addEventListener("abort", onAbort, { once: true });

    try {
      if (external?.aborted) deadline.fail();
      const response = await deadline.wait(() => {
        const pending = fetcher(input, { ...init, signal: deadline.signal });
        void pending.then(
          (late) => {
            if (deadline.signal.aborted) void late.body?.cancel().catch(() => undefined);
          },
          () => undefined,
        );
        return pending;
      });
      const bytes = await deadline.wait(() => response.arrayBuffer());
      const buffered = bufferedResponse(response, bytes);
      deadline.assertActive();
      return buffered;
    } catch {
      deadline.fail();
      return unavailableResponse();
    } finally {
      external?.removeEventListener("abort", onAbort);
    }
  };
}

/**
 * 제공자 작업을 하나의 전송 시간 예산 안에서 실행합니다.
 * @param fetcher 실제 제공자 HTTP 전송 함수.
 * @param work 같은 시간 예산과 보호된 fetch를 공유할 제공자 작업.
 * @returns 마감 전에 검증까지 끝난 작업 결과.
 * @throws 시간 초과·취소·알 수 없는 오류를 원문 없는 고정 AuthProviderError로 변환합니다.
 * 취소 책임: 성공·실패와 관계없이 내부 타이머와 신호를 정리하며 호출자 신호는 중단하지 않습니다.
 */
export async function runProviderOperation<T>(
  fetcher: typeof fetch,
  work: (operation: ProviderOperation) => Promise<T>,
): Promise<T> {
  const deadline = createProviderDeadline();
  try {
    const result = await deadline.wait(() => work({
      fetch: guardedFetch(fetcher, deadline),
      assertActive: deadline.assertActive,
    }));
    deadline.assertActive();
    return result;
  } catch (error) {
    return rethrowProviderError(error);
  } finally {
    deadline.close();
  }
}
