import { randomUUID } from "node:crypto";
import { BankError, bankUnavailable } from "./bank-error.js";
import type { BankRepositoryPort } from "./bank-repository.js";
import type { BankIdentity } from "./bank-repository.types.js";
import type { BankServiceOptions } from "./bank-provider.js";
import { boundedExchange, callbackAddressDigest, fixedUrl, validateOptions } from "./bank-runtime-safety.js";
import { parseCallback, parseComplete, parseRequestId, parseStart, parseTokens } from "./bank-validation.js";
import { createConnectionSecret, hashConnectionSecret } from "./security/connection-secret.js";
import { decryptBankToken, encryptBankToken, type BankTokenContext } from "./security/token-envelope.js";

/** 저장소의 commit 경계와 공급자 통신을 순서대로 조율한다. 토큰 원문은 응답에 넣지 않는다. */
export class BankConnectionService {
  private readonly timeoutMs: number;
  /** @param repo 최소 권한 저장소. @param options API 서버 전용 키·고정 URL·공급자. */
  public constructor(private readonly repo: BankRepositoryPort, private readonly options: BankServiceOptions) {
    this.timeoutMs = validateOptions(options);
  }
  /** @param who JWT 검증된 본인/세션. @param input web 시작 본문. @returns 요청 ID와 일회용 은행 인가 URL. */
  public async start(who: BankIdentity, input: unknown) {
    const body = parseStart(input);
    this.checkLimit(await this.repo.consumeStart(who)); // quota는 이후 오류에도 환불하지 않는다.
    const requestId = randomUUID(), state = createConnectionSecret();
    let url: URL;
    try {
      url = new URL(this.options.provider.authorizationUrl(state));
      const allowed = fixedUrl(this.options.authorizationEndpoint);
      if (url.origin !== allowed.origin || url.pathname !== allowed.pathname || url.username || url.password || url.hash
        || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) throw new Error();
    } catch { throw bankUnavailable(); }
    const saved = await this.repo.start(who, requestId, this.options.provider.environment,
      Buffer.from(hashConnectionSecret(state), "hex"), Buffer.from(body.proofDigest, "hex"));
    if (!saved) throw new BankError("BANK_REQUEST_CONFLICT", 409);
    return { requestId: saved, authorizationUrl: url.href };
  }
  /** @param rawQuery 은행 Callback 원본 query. @param address 실제 socket 주소. @returns 코드 없는 고정 PC 결과 URL. */
  public async callback(rawQuery: string, address: string): Promise<string> {
    this.checkLimit(await this.repo.consumeCallback(callbackAddressDigest(address, this.options.callbackHmacKey)));
    const data = parseCallback(rawQuery), context = await this.repo.callbackContext(data.state);
    if (!context || context.environment !== this.options.provider.environment) throw new BankError("BANK_INVALID_REQUEST", 400);
    let envelope = null;
    try {
      if (data.code !== null) envelope = encryptBankToken(data.code, this.aad(context.userId, context.id, "authorization_code"), this.options.keys);
    } catch { throw bankUnavailable(); }
    const id = await this.repo.receiveCallback(data.state, envelope, data.denied);
    if (!id) throw new BankError("BANK_INVALID_REQUEST", 400);
    const url = fixedUrl(this.options.webResultUrl); url.searchParams.set("requestId", id);
    return url.href;
  }
  /** @param who 재검증된 본인/세션. @param input 요청 ID와 BFF proof 지문. @returns 암호화 저장 완료 상태만. */
  public async complete(who: BankIdentity, input: unknown) {
    const body = parseComplete(input), proof = Buffer.from(body.proofDigest, "hex");
    await this.context(who, body.requestId);
    let claimed;
    try { claimed = await this.repo.claim(who, body.requestId, proof); }
    catch { throw bankUnavailable(); } // claim commit 확인 실패 시 교환하지 않는다.
    if (!claimed) throw new BankError("BANK_REQUEST_CONFLICT", 409);
    try {
      const code = decryptBankToken(claimed, this.aad(who.userId, body.requestId, "authorization_code"), this.options.keys);
      const tokens = parseTokens(await boundedExchange(signal => this.options.provider.exchange(code, signal), this.timeoutMs));
      const connectionId = randomUUID();
      const encrypt = (value: string, purpose: BankTokenContext["purpose"]) => encryptBankToken(value, this.aad(who.userId, connectionId, purpose), this.options.keys);
      const ok = await this.repo.finish(who, body.requestId, proof, { connectionId,
        subject: encrypt(tokens.providerSubject, "provider_subject"), access: encrypt(tokens.accessToken, "access_token"),
        refresh: tokens.refreshToken === null ? null : encrypt(tokens.refreshToken, "refresh_token"),
        accessExpiresAt: tokens.accessExpiresAt, refreshExpiresAt: tokens.refreshExpiresAt, consentExpiresAt: tokens.consentExpiresAt });
      if (!ok) throw bankUnavailable();
      return { requestId: body.requestId, status: "connected" as const };
    } catch {
      try { await this.repo.fail(who, body.requestId, proof); } catch { /* 재시도하지 않고 DB 만료 정리에 맡긴다. */ }
      throw bankUnavailable();
    }
  }
  /** @param who JWT 본인/세션. @param id 요청 UUID. @returns 토큰·공급자 식별자를 제외한 상태 2필드. */
  public async status(who: BankIdentity, id: unknown) {
    const row = await this.context(who, parseRequestId(id));
    return { requestId: row.requestId, status: row.status };
  }
  /** @param who 본인/세션. @param id 요청 UUID. @returns 현재 공급자 환경과 일치하는 소유 요청만. */
  private async context(who: BankIdentity, id: string) {
    const row = await this.repo.context(who, id);
    if (!row || row.environment !== this.options.provider.environment) throw new BankError("BANK_REQUEST_NOT_FOUND", 404);
    return row;
  }
  /** @param result DB가 commit한 한도 판정. @throws 초과 시 남은 대기 초를 가진 고정 오류. */
  private checkLimit(result: { allowed: boolean; retryAfterSeconds: number }): void {
    if (!result.allowed) throw new BankError("BANK_RATE_LIMITED", 429, Math.max(1, result.retryAfterSeconds));
  }
  /** @param userId 소유자. @param resourceId 요청/연결 UUID. @param purpose 암호문 용도. @returns 혼용 방지 AAD. */
  private aad(userId: string, resourceId: string, purpose: BankTokenContext["purpose"]): BankTokenContext {
    return { userId, resourceId, purpose, provider: "kftc", environment: this.options.provider.environment };
  }
}
