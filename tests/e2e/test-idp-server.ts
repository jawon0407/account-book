import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const HOST = "127.0.0.1";
const PORT = 4510;
const ISSUER = `http://${HOST}:${PORT}`;
const AUDIENCE = "account-book-api";
const TEST_EMAIL = "verified@example.test";
const TEST_PASSWORD = "correct horse battery staple";
const TEST_REFRESH_TOKEN = "e2e-provider-refresh-token-must-never-reach-browser";
const USER_ID = "123e4567-e89b-42d3-a456-426614174001";
const MAX_BODY_BYTES = 4096;

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "ES256",
  kid: "e2e-process-key",
  use: "sig",
};

/**
 * JSON 응답과 no-store 헤더를 작성하고 응답 스트림을 끝낸다.
 * @param response - Node HTTP 응답 객체다.
 * @param status - 전송할 HTTP 상태 코드다.
 * @param body - JSON 직렬화 대상. 합성 테스트 응답에 사용한다.
 * @returns 반환값 없음. 네트워크 응답을 쓰며 직렬화/스트림 오류는 전파한다.
 */
function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

/**
 * 요청 스트림을 최대 4096바이트까지 모아 JSON으로 읽는다.
 * @param request - 본문을 한 번 소비할 Node HTTP 요청이다.
 * @returns 검증 전 JSON 값의 Promise.
 * @throws 초과 시 IDP_REQUEST_INVALID, 잘못된 JSON이나 스트림 오류는 전파한다.
 */
async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_BODY_BYTES) throw new Error("IDP_REQUEST_INVALID");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * 정확히 email/password 두 키와 고정 합성 자격증명이 일치하는지 검사한다.
 * @param value - 요청 본문을 파싱한 임의 값이다.
 * @returns 일치하면 true. 실제 인증 공급자를 호출하지 않는다.
 */
function credentials(value: unknown): value is Readonly<{ email: string; password: string }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "email,password"
    && record.email === TEST_EMAIL
    && record.password === TEST_PASSWORD;
}

/**
 * 프로세스 전용 키로 테스트 ES256 JWT를 서명한다.
 * @param payload - JSON으로 인코딩할 테스트 claim 객체다. 이 함수는 claim 의미를 검사하지 않는다.
 * @returns header.payload.signature 형식 문자열. 서명 실패는 전파하고 키/결과를 출력하지 않는다.
 */
function token(payload: Readonly<Record<string, unknown>>): string {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: publicJwk.kid, typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const input = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

const server = createServer(async (request, response) => {
  const target = new URL(request.url ?? "/", ISSUER);
  if (request.method === "GET" && target.pathname === "/health" && target.search === "") {
    return json(response, 200, { status: "ok" });
  }
  if (request.method === "GET" && target.pathname === "/jwks" && target.search === "") {
    return json(response, 200, { keys: [publicJwk] });
  }
  if (request.method === "POST" && target.pathname === "/token" && target.search === "") {
    try {
      if (request.headers["content-type"] !== "application/json") throw new Error("IDP_REQUEST_INVALID");
      const input = await body(request);
      if (!credentials(input)) return json(response, 401, { code: "AUTH_INVALID_CREDENTIALS" });
      const issuedAtSeconds = Math.floor(Date.now() / 1000);
      const accessTokenExpiresAt = new Date((issuedAtSeconds + 300) * 1000);
      const supabaseSessionId = randomUUID();
      return json(response, 200, {
        accessToken: token({
          aud: AUDIENCE,
          exp: issuedAtSeconds + 300,
          iat: issuedAtSeconds,
          iss: ISSUER,
          session_id: supabaseSessionId,
          sub: USER_ID,
        }),
        accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
        issuedAtSeconds,
        refreshToken: TEST_REFRESH_TOKEN,
        supabaseSessionId,
        user: { email: TEST_EMAIL, emailVerified: true, id: USER_ID },
        userId: USER_ID,
      });
    } catch {
      return json(response, 400, { code: "AUTH_INVALID_CREDENTIALS" });
    }
  }
  return json(response, 404, { code: "NOT_FOUND" });
});

server.listen(PORT, HOST);

/**
 * 테스트 IDP의 연결과 서버를 닫는 종료 signal handler다.
 * @returns 반환값 없음. 닫기 callback에 오류가 있으면 프로세스 종료 코드를 1로 설정한다.
 */
function close(): void {
  server.closeAllConnections();
  server.close((error) => {
    if (error !== undefined) process.exitCode = 1;
  });
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
