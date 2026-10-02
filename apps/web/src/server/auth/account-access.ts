import "server-only";

import { createHmac } from "node:crypto";
import { PasswordResetRequestInputSchema } from "@account-book/contracts";
import { hashSessionSelector } from "../security/session-selector.js";
import { AuthProviderError } from "./auth-provider-port.js";

export type AccountLookupKind = "sign_up" | "password_reset";
export type AccountAccessPort = Readonly<{
  /** @param email 검증할 이메일. @param kind 가입/복구. @param selector CSRF를 통과한 브라우저 문맥. */
  check(email: string, kind: AccountLookupKind, selector: string): Promise<"present" | "absent">;
}>;
type Query = (text: string, values: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** 회원 목록 권한 없이 제한된 SQL 함수로 이메일 존재 여부와 요청 예산만 확인한다. */
export class AccountAccess implements AccountAccessPort {
  /** @param query BFF 역할의 매개변수화 DB 호출. @param key 이메일·브라우저 지문용 서버 HMAC 키. */
  public constructor(private readonly query: Query, private readonly key: Uint8Array) {
    if (key.length !== 32) throw new AuthProviderError();
  }

  /**
   * 가입 여부 공개는 사용자가 승인한 정책이다. SQL 실패를 absent로 오인하지 않고 503으로 종료한다.
   * @param email 이메일 한 개; 원문을 로그에 기록하지 않는다.
   * @param kind 요청 예산 종류. @param selector 이미 CSRF 검증한 불투명 식별자.
   * @returns 존재/미존재만 반환. ID·가입 경로·회원 목록은 공개하지 않는다.
   */
  public async check(email: string, kind: AccountLookupKind, selector: string): Promise<"present" | "absent"> {
    try {
      const parsed = PasswordResetRequestInputSchema.parse({ email });
      if (!["sign_up", "password_reset"].includes(kind)) throw new AuthProviderError();
      hashSessionSelector(selector);
      const normalized = parsed.email.toLowerCase();
      const emailHash = createHmac("sha256", this.key).update(`account-email:${normalized}`).digest();
      const browserHash = createHmac("sha256", this.key).update(`account-browser:${selector}`).digest();
      const result = await this.query("select app_private.check_email_account($1,$2,$3,$4) as status", [normalized, kind, emailHash, browserHash]);
      const status = result.rows.length === 1 ? result.rows[0]?.status : undefined;
      if (status === "rate_limited") throw new AuthProviderError("AUTH_RATE_LIMITED");
      if (status !== "present" && status !== "absent") throw new AuthProviderError();
      return status;
    } catch (error) {
      if (error instanceof AuthProviderError) throw error;
      throw new AuthProviderError();
    }
  }
}
