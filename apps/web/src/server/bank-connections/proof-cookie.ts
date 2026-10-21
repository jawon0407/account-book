import { createHash, randomBytes } from "node:crypto";
import { CoreBoundaryError } from "../core/http-boundary.js";

/** @param requestId 경계에서 검증한 UUID. 늦은 이전 응답이 새 연결 쿠키를 지우지 않도록 이름을 분리한다. */
const name = (requestId: string) => `__Host-ab_bank_proof_${requestId}`;
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
export const proofCookie = (requestId: string, proof: string) => `${name(requestId)}=${requestId}.${proof}${ATTRIBUTES}300`;
/** @param requestId 소비한 요청 UUID. 다른 요청과 인증 세션 쿠키에는 영향을 주지 않는다. */
export const clearProofCookie = (requestId: string) => `${name(requestId)}=${ATTRIBUTES}0`;
/** @param request 브라우저 요청. @param requestId 대상 UUID. @returns 같은 요청의 확인값 지문. 중복 쿠키는 거부한다. */
export function readProof(request: Request, requestId: string): string {
  const cookieName = name(requestId);
  const values = (request.headers.get("cookie") ?? "").split(";").map(p => p.trim()).filter(p => p.split("=", 1)[0] === cookieName);
  const parts = values[0]?.slice(cookieName.length + 1).split(".");
  if (values.length !== 1 || parts?.length !== 2 || parts[0] !== requestId) throw new CoreBoundaryError("BANK_REQUEST_CONFLICT", 409);
  return proofDigest(parts[1]!);
}
