import {
  CreateTransactionInputSchema,
  type CreateTransactionInput,
  type Transaction,
} from "@account-book/contracts";
import { ClientError, type ClientErrorCode } from "../api/client-error";
import type { ManualInput } from "./manual-input";

export type ManualEntryState = Readonly<
  | { status: "editing" | "saving" | "disposed" }
  | { status: "uncertain" | "failed"; error: ClientErrorCode }
  | { status: "saved"; transaction: Transaction }
>;
const InputSchema = CreateTransactionInputSchema.omit({ idempotencyKey: true });
const rejectedCodes = new Set<ClientErrorCode>([
  "LEDGER_VALIDATION_FAILED",
  "LEDGER_ACCOUNT_UNAVAILABLE",
  "LEDGER_CATEGORY_UNAVAILABLE",
  "LEDGER_TIME_SETUP_REQUIRED",
  "LEDGER_TIME_REVIEW_REQUIRED",
  "LEDGER_TIME_CHANGE_REQUIRED",
  "AUTH_SESSION_EXPIRED",
  "AUTH_RATE_LIMITED",
]);

/** 한 기록 시도를 메모리에만 유지한다. 금융 원문의 영구 대기열이나 자동 재전송은 만들지 않는다. */
export class ManualEntry {
  private state: ManualEntryState = { status: "editing" };
  private attempt: CreateTransactionInput | null = null;
  private fingerprint: string | null = null;
  private inFlight: Promise<Transaction> | null = null;
  private listeners = new Set<() => void>();
  /** @param send 현재 계정의 인증 guard. @param createKey OS 암호학적 UUID 생성기. */
  public constructor(
    private readonly send: (
      input: CreateTransactionInput,
    ) => Promise<Transaction>,
    private readonly createKey: () => string,
  ) {}
  public snapshot = (): ManualEntryState => this.state;
  /** @param listener 상태 변화 시 화면 갱신. 해제 함수를 반환한다. */
  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** @param input 검증할 수기 값. 같은 시도의 중복 탭만 공유하고 다른 값은 새로 전송하지 않는다. */
  public submit(input: ManualInput): Promise<Transaction> {
    if (this.state.status === "disposed")
      return Promise.reject(new ClientError("SESSION_CHANGED"));
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(new ClientError("LEDGER_VALIDATION_FAILED"));
    const fingerprint = JSON.stringify(parsed.data);
    if (this.inFlight)
      return fingerprint === this.fingerprint
        ? this.inFlight
        : Promise.reject(new ClientError("LEDGER_IDEMPOTENCY_CONFLICT"));
    if (this.state.status === "uncertain" || this.state.status === "saved")
      return Promise.reject(new ClientError("LEDGER_IDEMPOTENCY_CONFLICT"));
    const value = CreateTransactionInputSchema.safeParse({
      ...parsed.data,
      idempotencyKey: this.createKey(),
    });
    if (!value.success)
      return Promise.reject(new ClientError("LEDGER_VALIDATION_FAILED"));
    if (value.data.time) Object.freeze(value.data.time);
    this.attempt = Object.freeze(value.data);
    this.fingerprint = fingerprint;
    return this.start();
  }
  /** 결과 불명인 같은 시도만 명시적으로 다시 확인한다. payload/키는 변경하지 않는다. */
  public retry(): Promise<Transaction> {
    if (this.state.status === "saving" && this.inFlight) return this.inFlight;
    if (this.state.status !== "uncertain" || !this.attempt)
      return Promise.reject(new ClientError("SESSION_CHANGED"));
    return this.start();
  }
  /** 안전하게 새 입력으로 돌아갈 수 있을 때만 상태를 비운다. 결과 불명/진행 중은 false다. */
  public beginNew(): boolean {
    if (["uncertain", "saving", "disposed"].includes(this.state.status))
      return false;
    this.reset();
    return true;
  }
  /** UI가 저장 가능성 안내와 목록 확인 후 사용자의 명시적 선택을 받았을 때만 호출한다. */
  public confirmListChecked(): void {
    if (this.state.status === "uncertain") this.reset();
  }
  /** 로그아웃/계정 변경 시 호출. 이미 서버에 도착한 쓰기를 취소했다고 주장하지 않는다. */
  public dispose(): void {
    this.attempt = null;
    this.fingerprint = null;
    this.publish({ status: "disposed" });
    this.listeners.clear();
  }
  private reset(): void {
    this.attempt = null;
    this.fingerprint = null;
    this.publish({ status: "editing" });
  }
  private publish(value: ManualEntryState): void {
    this.state = value;
    this.listeners.forEach((listener) => listener());
  }
  /** 동일한 변경 불가 payload를 한 번 보낸다. 실패가 확정되지 않으면 시도를 보존한다. */
  private start(): Promise<Transaction> {
    const attempt = this.attempt!;
    this.publish({ status: "saving" });
    this.inFlight = this.run(attempt).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async run(attempt: CreateTransactionInput): Promise<Transaction> {
    try {
      const transaction = await this.send(attempt);
      if (this.state.status === "disposed")
        throw new ClientError("SESSION_CHANGED");
      this.attempt = null;
      this.fingerprint = null;
      this.publish({ status: "saved", transaction });
      return transaction;
    } catch (cause) {
      if (this.state.status === "disposed")
        throw new ClientError("SESSION_CHANGED");
      const error =
        cause instanceof ClientError ? cause : new ClientError("UNAVAILABLE");
      const rejected =
        error.status !== undefined &&
        error.status >= 400 &&
        error.status < 500 &&
        rejectedCodes.has(error.code);
      if (rejected) {
        this.attempt = null;
        this.fingerprint = null;
      }
      this.publish({
        status: rejected ? "failed" : "uncertain",
        error: error.code,
      });
      throw error;
    }
  }
}
