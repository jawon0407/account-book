import { fetch as expoFetch } from "expo/fetch";

/**
 * Android의 OkHttp 기반 Expo 전송기를 사용한다. RN 기본 XHR fetch는 redirect 옵션을
 * 보장하지 않으므로 사용하지 않는다. Request 변환 중 누락되어도 init에 정책을 다시 고정한다.
 * @param input 고정 API URL 또는 ky가 만든 Request. @param init AbortSignal 등 요청 옵션.
 */
export const androidTransport: typeof fetch = (input, init) =>
  expoFetch(input, { ...init, redirect: "error", credentials: "omit" });
