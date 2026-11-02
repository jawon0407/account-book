import { z } from "zod";
import { BankError, bankUnavailable } from "./bank-error.js";
import { hashConnectionSecret } from "./security/connection-secret.js";

const Id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const Proof = z.string().regex(/^[0-9a-f]{64}$/u);
const Start = z.strictObject({ channel: z.literal("web"), proofDigest: Proof });
const Complete = z.strictObject({ requestId: Id, proofDigest: Proof });
const Secret = z.string().min(1).refine(s => Buffer.byteLength(s, "utf8") <= 65_536 && Buffer.from(s).toString("utf8") === s);
const Future = z.date().refine(d => d.getTime() > Date.now());
const Tokens = z.strictObject({
  providerSubject: Secret, accessToken: Secret, refreshToken: Secret.nullable(),
  accessExpiresAt: Future, refreshExpiresAt: Future.nullable(), consentExpiresAt: Future.nullable(),
  permissions: z.tuple([z.literal("accounts:read")]),
}).refine(t => (t.refreshToken === null) === (t.refreshExpiresAt === null));

/** @param schema 서버의 엄격한 스키마. @param value 비신뢰 요청. @returns 공개 오류로 정규화한 입력. */
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BankError("BANK_INVALID_REQUEST", 400);
  return result.data;
}
/** @param value 클라이언트 시작 본문. @returns 소유자 필드 등을 거부한 입력. */
export const parseStart = (value: unknown) => input(Start, value);
/** @param value 클라이언트 완료 본문. @returns UUID와 지문만 포함한 입력. */
export const parseComplete = (value: unknown) => input(Complete, value);
/** @param value 경로의 요청 ID. @returns 정규형 UUID. */
export const parseRequestId = (value: unknown) => input(Id, value);
/** @param value 공급자 내부 정규화 응답. @returns 조회 권한과 미래 만료가 검증된 토큰. */
export function parseTokens(value: unknown) {
  const result = Tokens.safeParse(value);
  if (!result.success) throw bankUnavailable();
  return result.data;
}
/** @param rawQuery Callback 원본 query. @returns 중복/추가 필드 없는 state 지문과 코드 또는 거절. */
export function parseCallback(rawQuery: string) {
  try {
    if (!rawQuery || rawQuery.length > 16_384) throw new Error();
    for (const part of rawQuery.split("&")) decodeURIComponent(part.replace(/\+/gu, " "));
    const params = new URLSearchParams(rawQuery), keys = [...params.keys()];
    if (keys.length !== 2 || new Set(keys).size !== 2 || !keys.includes("state")
      || !keys.every(k => ["state", "code", "error"].includes(k))) throw new Error();
    const state = Buffer.from(hashConnectionSecret(params.get("state")!), "hex");
    const denied = params.has("error"), value = params.get(denied ? "error" : "code")!;
    if (!value || [...value].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      || Buffer.byteLength(value, "utf8") > (denied ? 128 : 4096)) throw new Error();
    return { state, denied, code: denied ? null : value };
  } catch { throw new BankError("BANK_INVALID_REQUEST", 400); }
}
