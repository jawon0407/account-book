import { randomBytes } from "node:crypto";
import { vi } from "vitest";
import type { BankRepositoryPort } from "../bank-repository.js";
import type { BankCredentials, BankIdentity, BankRequestContext } from "../bank-repository.types.js";
import type { BankTokenEnvelope } from "../security/token-envelope.js";

/** @returns 외부 통신 없는 서비스/HTTP용 합성 fixture. 런타임 모듈에서 import하지 않는다. */
export function bankFixture() {
  const who = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222" };
  const proofDigest = "ab".repeat(32), events: string[] = [];
  let row: BankRequestContext | null = null, code: BankTokenEnvelope | null = null;
  let stateDigest: Buffer = Buffer.alloc(0), proof: Buffer = Buffer.alloc(0);
  let stored: BankCredentials | null = null;
  const same = (identity: BankIdentity) => identity.userId === who.userId && identity.sessionId === who.sessionId;
  const repo: BankRepositoryPort = {
    consumeStart: vi.fn(async () => { events.push("quota-committed"); return { allowed: true, retryAfterSeconds: 0 }; }),
    consumeCallback: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
    start: vi.fn(async (_who, id, environment, state, p) => { events.push("start-committed"); row = { requestId: id, status: "awaiting_callback", environment }; stateDigest = state; proof = p; return id; }),
    callbackContext: vi.fn(async digest => row?.status === "awaiting_callback" && digest.equals(stateDigest) ? { id: row.requestId, userId: who.userId, environment: row.environment } : null),
    receiveCallback: vi.fn(async (_digest, envelope, denied) => { if (!row || row.status !== "awaiting_callback") return null; row.status = denied ? "failed" : "awaiting_completion"; code = envelope; return row.requestId; }),
    context: vi.fn(async (identity, id) => row && same(identity) && row.requestId === id ? { ...row } : null),
    claim: vi.fn(async (identity, id, p) => { if (!row || !same(identity) || row.requestId !== id || row.status !== "awaiting_completion" || !p.equals(proof)) return null; row.status = "exchanging"; const result = code; code = null; events.push("claim-committed"); return result; }),
    finish: vi.fn(async (_who, _id, _proof, value) => { stored = value; if (row) row.status = "connected"; events.push("finish-committed"); return true; }),
    fail: vi.fn(async () => { if (row?.status === "exchanging") row.status = "failed"; }),
  };
  const response = () => ({ providerSubject: "fake-subject", accessToken: "fake-access", refreshToken: null, accessExpiresAt: new Date(Date.now() + 60_000), refreshExpiresAt: null, consentExpiresAt: null, permissions: ["accounts:read"] });
  const provider = { environment: "fake" as const,
    authorizationUrl: (state: string) => `https://bank.invalid/authorize?state=${state}`,
    exchange: vi.fn<(code: string, signal: AbortSignal) => Promise<unknown>>(async () => { events.push("exchange"); return response(); }) };
  const options = { provider, keys: { activeKid: "test", keys: new Map([["test", randomBytes(32)]]) }, callbackHmacKey: randomBytes(32), authorizationEndpoint: "https://bank.invalid/authorize", webResultUrl: "https://web.invalid/app/bank-connections/result" };
  return { who, proofDigest, repo, provider, options, events, response, stored: () => stored };
}
