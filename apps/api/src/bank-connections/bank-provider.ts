import type { BankEnvironment } from "./bank-repository.types.js";
import type { BankTokenKeyring } from "./security/token-envelope.js";

/** 공식 HTTP adapter가 구현할 경계. fake 구현은 testing 폴더에서만 제공한다. */
export interface BankProvider {
  readonly environment: BankEnvironment;
  /** @param state 서버가 생성한 일회용 난수. @returns 허용된 은행 인가 URL. */
  authorizationUrl(state: string): string;
  /** @param code 일회용 인가 코드. @param signal 제한 시간 취소 신호. @returns 검증 전 정규화 응답. 자동 재시도 금지. */
  exchange(code: string, signal: AbortSignal): Promise<unknown>;
}
export type BankServiceOptions = Readonly<{
  provider: BankProvider; keys: BankTokenKeyring; callbackHmacKey: Uint8Array;
  authorizationEndpoint: string; webResultUrl: string; timeoutMs?: number;
}>;
