export type NativeOperation = "signIn" | "session" | "refresh" | "signOut";
export type NativeRateOperation = NativeOperation | "ledgerRead" | "ledgerWrite";
export type NativeRateScope = "global" | "email" | "device" | "identity";
export type NativeRateLimitPort = Readonly<{
  /** @param operation 고정 서버 작업. @param scope 제한 단위. @param value HMAC 처리할 구분값. */
  consume(operation: NativeRateOperation, scope: NativeRateScope, value: string): Promise<boolean>;
}>;
