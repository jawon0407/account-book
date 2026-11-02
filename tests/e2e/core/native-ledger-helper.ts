import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { NativeAuthResponseSchema } from "../../../packages/contracts/src/native-auth.js";

// 한 worker에서 합성 계정의 native 세션을 재사용한다. 토큰은 메모리에만 두고 브라우저에는 넘기지 않는다.
const sessions = new Map<string, string>();
/** @param request 브라우저 쿠키와 분리된 Playwright HTTP fixture. @param email 합성 IdP 계정. */
export async function nativeLedger(request: APIRequestContext, email = "verified@example.test") {
  let sessionToken = sessions.get(email);
  if (!sessionToken) {
    const response = await request.post("/api/native/auth/sign-in", { data: { email, password: "correct horse battery staple", deviceId: randomUUID() } });
    expect(response.status()).toBe(200);
    sessionToken = NativeAuthResponseSchema.parse(await response.json()).sessionToken;
    sessions.set(email, sessionToken);
  }
  const headers = { Authorization: `Bearer ${sessionToken}` };
  return {
    /** @param path 고정 테스트 경로. GET만 실행하며 자동 재전송은 없다. */
    get: (path: string) => request.get("/api/native/" + path, { headers, maxRetries: 0 }),
    /** @param path 고정 테스트 경로. @param data 한 생성 의도의 본문. 저장 전 키는 호출자가 고정할 수 있다. */
    post: (path: string, data: object) => request.post("/api/native/" + path, { headers, data, maxRetries: 0 }),
    /** @param path 고정 경로. @param data 읽은 버전을 포함한 수정 의도. */
    patch: (path: string, data: object) => request.patch("/api/native/" + path, { headers, data, maxRetries: 0 }),
  };
}
