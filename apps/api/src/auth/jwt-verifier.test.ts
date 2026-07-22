import { generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { InvalidAccessTokenError, JwtAccessTokenVerifier } from "./jwt-verifier.js";

const issuer = "https://id.example.test/auth/v1";
const audience = "authenticated";
const userId = "123e4567-e89b-12d3-a456-426614174000";
const sessionId = "123e4567-e89b-12d3-a456-426614174001";

describe("JwtAccessTokenVerifier", () => {
  let privateKey: CryptoKey;
  let otherPrivateKey: CryptoKey;
  let verifier: JwtAccessTokenVerifier;

  beforeAll(async () => {
    const primary = await generateKeyPair("ES256");
    const other = await generateKeyPair("ES256");
    privateKey = primary.privateKey;
    otherPrivateKey = other.privateKey;
    verifier = new JwtAccessTokenVerifier(
      { issuer, audience, algorithm: "ES256" },
      async () => primary.publicKey,
    );
  });

  async function token(overrides: Readonly<Record<string, unknown>> = {}, signingKey = privateKey): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      aud: audience,
      exp: now + 60,
      iat: now,
      iss: issuer,
      nbf: now - 1,
      session_id: sessionId,
      sub: userId,
      ...overrides,
    };
    return new SignJWT(payload).setProtectedHeader({ alg: "ES256", kid: "local-test" }).sign(signingKey);
  }

  it("returns only the UUID principal from a valid ES256 token", async () => {
    await expect(verifier.verify(await token({ email: "ignored@example.test", role: "admin" }))).resolves.toEqual({
      userId,
      sessionId,
    });
  });

  it.each([
    ["wrong issuer", { iss: "https://wrong.invalid" }],
    ["wrong audience", { aud: "other" }],
    ["extra audience", { aud: [audience, "other"] }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 1 }],
    ["missing expiration", { exp: undefined }],
    ["future not-before", { nbf: Math.floor(Date.now() / 1000) + 60 }],
    ["invalid not-before", { nbf: "later" }],
    ["missing subject", { sub: undefined }],
    ["invalid subject UUID", { sub: userId.toUpperCase() }],
    ["missing session", { session_id: undefined }],
    ["invalid session UUID", { session_id: "00000000-0000-0000-0000-000000000000" }],
  ])("rejects %s with one safe error", async (_name, overrides) => {
    const promise = verifier.verify(await token(overrides));
    await expect(promise).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(promise).rejects.toThrow("AUTH_ACCESS_TOKEN_INVALID");
  });

  it("rejects an invalid signature, missing signature, and disallowed algorithm", async () => {
    const valid = await token();
    const [header, payload] = valid.split(".");
    const wrongAlgorithmHeader = Buffer.from(JSON.stringify({ alg: "RS256", kid: "local-test" })).toString("base64url");

    await expect(verifier.verify(await token({}, otherPrivateKey))).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(verifier.verify(`${header}.${payload}.`)).rejects.toBeInstanceOf(InvalidAccessTokenError);
    await expect(verifier.verify(`${wrongAlgorithmHeader}.${payload}.${valid.split(".")[2]}`)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it("turns resolver failures into a fixed unavailable error without provider detail", async () => {
    const unavailable = new JwtAccessTokenVerifier(
      { issuer, audience, algorithm: "ES256" },
      async () => { throw new Error("https://id.example.test/jwks?secret=provider-detail"); },
    );

    await expect(unavailable.verify(await token())).rejects.toMatchObject({
      name: "AccessTokenVerificationUnavailableError",
      message: "AUTH_VERIFICATION_UNAVAILABLE",
    });
    await expect(unavailable.verify(await token())).rejects.not.toThrow(/provider-detail/u);
  });
});
