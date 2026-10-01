import { createPrivateKey, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import { DelegatedJwtSigner } from "../../apps/web/src/server/security/delegated-jwt-signer.ts";

const config = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, "account-book/dev-auth/web.json"), "utf8"));
const ca = readFileSync(join(process.env.LOCALAPPDATA, "mkcert/rootCA.pem"));
const passed = [];
let stage = "https";

/** @param {boolean} ok 기대 동작 여부. @param {string} name 비밀값 없는 검사 이름. */
function check(ok, name) { if (!ok) throw new Error(name); passed.push(name); }

/**
 * 신뢰된 로컬 CA·호스트명 검증을 유지한 HTTP 검사. 토큰·쿠키는 함수 메모리에만 보관합니다.
 * @param {string} path 고정 localhost 경로.
 * @param {object} options method/headers/body. 응답 body는 출력하지 않습니다.
 * @returns {Promise<object>} 검사에 사용할 응답 상태·헤더·JSON.
 */
function call(path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`https://localhost:3000${path}`, { ca, family: 4, method, headers, timeout: 20_000 }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; if (text.length > 100_000) req.destroy(new Error("BODY_LIMIT")); });
      response.on("end", () => {
        let json;
        try { json = JSON.parse(text); } catch { /* HTML 응답의 본문은 보관/출력하지 않는다. */ }
        resolve({ status: response.statusCode, headers: response.headers, json });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("TIMEOUT")));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

try {
  const csrf = await call("/api/auth/csrf");
  check(csrf.status === 200 && typeof csrf.json?.csrfToken === "string", "csrf-200");
  check(csrf.headers["cache-control"] === "private, no-store", "csrf-no-store");
  const cookie = csrf.headers["set-cookie"]?.[0];
  check(typeof cookie === "string" && cookie.startsWith("__Host-") && /; HttpOnly;/u.test(cookie) && /; Secure;/u.test(cookie) && /; Path=\//u.test(cookie) && !/; Domain=/iu.test(cookie), "secure-host-cookie");
  const headers = { "content-type": "application/json", origin: config.APP_ORIGIN, "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", cookie: cookie.split(";")[0], "x-csrf-token": csrf.json.csrfToken };
  const input = { email: `probe-${randomUUID()}@example.invalid`, password: randomBytes(24).toString("base64url") };
  stage = "auth-rejections";
  check((await call("/api/auth/session")).status === 401, "unauthenticated-session-401");
  check((await call("/api/me")).status === 401, "unauthenticated-bff-me-401");
  check((await call("/api/auth/sign-in", { method: "POST", headers: { ...headers, "x-csrf-token": "invalid" }, body: input })).status === 403, "invalid-csrf-rejected");
  check((await call("/api/auth/sign-in", { method: "POST", headers: { ...headers, origin: "https://foreign.example", "sec-fetch-site": "cross-site" }, body: input })).status === 403, "cross-origin-rejected");
  // 이메일을 발송하지 않는다. 신규 계정 생성은 사용자의 실제 브라우저 여정에서 별도로 확인한다.
  const invalidSignup = await call("/api/auth/sign-up", { method: "POST", headers, body: { email: "invalid", password: "short" } });
  check(invalidSignup.status === 422, "invalid-signup-rejected-before-provider");
  const invalidLogin = await call("/api/auth/sign-in", { method: "POST", headers, body: input });
  check(invalidLogin.status === 401 && invalidLogin.json?.code === "AUTH_INVALID_CREDENTIALS", "real-provider-invalid-login-401");
  stage = "delegated-api";
  check((await fetch("http://127.0.0.1:3001/health", { signal: AbortSignal.timeout(5_000) })).status === 200, "api-health-200");
  check((await fetch("http://127.0.0.1:3001/v1/me", { signal: AbortSignal.timeout(5_000) })).status === 401, "api-no-token-401");
  const signer = new DelegatedJwtSigner({ keyId: config.BFF_JWT_KEY_ID, privateKey: createPrivateKey({ key: Buffer.from(config.BFF_JWT_PRIVATE_KEY, "base64url"), format: "der", type: "pkcs8" }), now: () => new Date() });
  // 임의 UUID는 신뢰 경계 smoke용 가상 주체다. 실제 Supabase 가입/로그인 성공의 증거가 아니다.
  const signed = await signer.sign({ method: "GET", target: "/v1/me", contentType: null, body: new Uint8Array(), scope: "me:read", userId: randomUUID(), sessionId: randomUUID() });
  const options = { headers: { authorization: `Bearer ${signed.token}`, "x-request-id": signed.requestId } };
  check((await fetch("http://127.0.0.1:3001/v1/me", { ...options, signal: AbortSignal.timeout(5_000) })).status === 200, "valid-delegated-jwt-200");
  check((await fetch("http://127.0.0.1:3001/v1/me", { ...options, signal: AbortSignal.timeout(5_000) })).status === 401, "delegated-jwt-replay-401");
  console.log(JSON.stringify({ status: "passed", checks: passed.length, passed, realSignup: "requires-user-email-confirmation", bankCalls: 0 }));
} catch {
  console.error(JSON.stringify({ status: "failed", stage, checksPassed: passed.length, lastPassed: passed.at(-1) }));
  process.exitCode = 1;
}
