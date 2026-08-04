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

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

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

function credentials(value: unknown): value is Readonly<{ email: string; password: string }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "email,password"
    && record.email === TEST_EMAIL
    && record.password === TEST_PASSWORD;
}

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

function close(): void {
  server.closeAllConnections();
  server.close((error) => {
    if (error !== undefined) process.exitCode = 1;
  });
}

process.once("SIGINT", close);
process.once("SIGTERM", close);
