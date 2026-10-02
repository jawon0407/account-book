import { createHash, randomBytes } from "node:crypto";
import { CoreBoundaryError } from "../core/http-boundary.js";

const NAME = "__Host-ab_bank_proof";
const ATTRIBUTES = "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=";

/** @param proof 비신뢰 base64url 값. @returns 정확한 32바이트 난수, 비표준 표기는 거부한다. */
function bytes(proof: string): Buffer {
  const result = Buffer.from(proof, "base64url");
  if (!/^[A-Za-z0-9_-]{43}$/u.test(proof) || result.length !== 32 || result.toString("base64url") !== proof) throw new CoreBoundaryError("BANK_REQUEST_CONFLICT", 409);
  return result;
}
/** 새로운 연결용 난수를 만든다. 로그인 세션/공급자 state와 공유하지 않는다. */
export const createProof = () => randomBytes(32).toString("base64url");
/** @param proof 브라우저 전용 난수. @returns API/DB용 해시; 원본을 전달하지 않는다. */
export const proofDigest = (proof: string) => createHash("sha256").update(bytes(proof)).digest("hex");
/** @param requestId 검증된 UUID. @param proof 생성한 난수. @returns HTTPS 전용 쿠키 헤더. */
export const proofCookie = (requestId: string, proof: string) => `${NAME}=${requestId}.${proof}${ATTRIBUTES}300`;
/** 소비한 확인값을 제거한다. 인증 세션 쿠키에는 영향을 주지 않는다. */
export const clearProofCookie = () => `${NAME}=${ATTRIBUTES}0`;
/** @param request 브라우저 요청. @param requestId 대상 UUID. @returns 같은 요청의 확인값 지문. 중복 쿠키는 거부한다. */
export function readProof(request: Request, requestId: string): string {
  const values = (request.headers.get("cookie") ?? "").split(";").map(p => p.trim()).filter(p => p.split("=", 1)[0] === NAME);
  const parts = values[0]?.slice(NAME.length + 1).split(".");
  if (values.length !== 1 || parts?.length !== 2 || parts[0] !== requestId) throw new CoreBoundaryError("BANK_REQUEST_CONFLICT", 409);
  return proofDigest(parts[1]!);
}
