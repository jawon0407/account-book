import type {
  CollectorChangeInput,
  CollectorState,
} from "@account-book/contracts";
import type { SessionManager } from "../auth/session-manager";
import { collectorFailure } from "./collector-copy";

// 성공 안내의 자동 종료 시간은 설정 모델 한 곳에서 관리한다.
export const COLLECTOR_TOAST_DURATION_MS = 2500;

export type CollectorSettingsState = Readonly<{
  phase: "idle" | "loading" | "ready" | "saving" | "error";
  value: CollectorState | null;
  confirmation: CollectorChangeInput | null;
  notice: string | null;
  toast: string | null;
}>;
const empty = (): CollectorSettingsState => ({
  phase: "idle",
  value: null,
  confirmation: null,
  notice: null,
  toast: null,
});
type Port = Pick<SessionManager, "collectorState" | "changeCollector">;

/** 화면 수명의 설정 모델. 계정/토큰 검사는 SessionManager, 쓰기 권한은 서버가 담당한다. */
export class CollectorSettings {
  private state = empty();
  private epoch = 0;
  private active = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  /** @param api 토큰을 노출하지 않는 현재 로그인 세션의 조회/변경 기능. */
  public constructor(private readonly api: Port) {}

  /** React가 같은 참조를 읽도록 변경 때만 새 스냅샷을 만든다. */
  public snapshot = (): CollectorSettingsState => this.state;
  /** @param listener 상태 변경 구독. 반환 함수는 해당 구독만 제거한다. */
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** 화면 진입/React effect 재설정 때 현재 상태를 다시 조회한다. */
  public start(): Promise<void> {
    this.active = true;
    return this.read();
  }
  /** 화면을 떠나면 이전 요청 결과를 버린다. 서버에서 이미 처리된 변경은 취소됐다고 주장하지 않는다. */
  public stop(): void {
    this.clearToastTimer();
    this.active = false;
    ++this.epoch;
    this.publish(empty());
  }
  /** 사용자가 요청한 새로고침. 저장/조회 중에는 요청을 더 만들지 않는다. */
  public async reload(): Promise<void> {
    if (!this.active || ["loading", "saving"].includes(this.state.phase))
      return;
    await this.read();
  }
  /** @param action 사용자가 고른 동작. 확정 전에는 서버에 쓰지 않고 현재 버전을 묶어 둔다. */
  public choose(action: CollectorChangeInput["action"]): void {
    const current = this.state.value;
    if (
      !this.active ||
      this.state.phase !== "ready" ||
      !current ||
      this.state.confirmation
    )
      return;
    if (action === "activate" && current.state === "active_here") return;
    if (action === "deactivate" && current.state === "inactive") return;
    const confirmation: CollectorChangeInput =
      action === "activate"
        ? {
            action,
            expectedVersion: current.version,
            replaceExisting: current.state === "active_elsewhere",
          }
        : { action, expectedVersion: current.version };
    this.clearToastTimer();
    this.publish({ ...this.state, confirmation, notice: null, toast: null });
  }
  /** 서버 요청 전 확인만 취소한다. 이미 저장 중인 요청에는 취소 성공 표시를 하지 않는다. */
  public cancel(): void {
    if (this.state.phase === "ready")
      this.publish({ ...this.state, confirmation: null });
  }
  /** 확인한 변경을 한 번만 전송한다. 실패하면 자동 재전송 대신 GET으로 상태를 확인한다. */
  public async confirm(): Promise<void> {
    const input = this.state.confirmation;
    if (!this.active || this.state.phase !== "ready" || !input) return;
    const epoch = ++this.epoch;
    this.clearToastTimer();
    this.publish({
      ...this.state,
      phase: "saving",
      confirmation: null,
      notice: null,
      toast: null,
    });
    try {
      const value = await this.api.changeCollector(input);
      if (!this.current(epoch)) return;
      this.publish({
        phase: "ready",
        value,
        confirmation: null,
        notice: null,
        toast:
          input.action === "activate"
            ? "기기 지정을 완료했습니다."
            : "기기 지정을 해제했습니다.",
      });
      // 현재 화면의 성공 응답에만 2.5초 안내를 붙인다. 새 작업/종료 시 타이머를 폐기한다.
      this.toastTimer = setTimeout(() => {
        this.toastTimer = null;
        if (this.current(epoch)) this.publish({ ...this.state, toast: null });
      }, COLLECTOR_TOAST_DURATION_MS);
    } catch (error) {
      if (this.current(epoch))
        await this.read(collectorFailure(error, "change"));
    }
  }
  /** @param notice 직전 변경 결과의 불확실성. 조회 성공만으로 변경 성공 안내로 바꾸지 않는다. */
  private async read(notice: string | null = null): Promise<void> {
    this.clearToastTimer();
    const epoch = ++this.epoch;
    this.publish({
      phase: "loading",
      value: null,
      confirmation: null,
      notice,
      toast: null,
    });
    try {
      const value = await this.api.collectorState();
      if (this.current(epoch))
        this.publish({
          phase: "ready",
          value,
          confirmation: null,
          notice,
          toast: null,
        });
    } catch (error) {
      if (this.current(epoch))
        this.publish({
          phase: "error",
          value: null,
          confirmation: null,
          toast: null,
          notice: notice
            ? `${notice} 현재 상태도 확인하지 못했어요. 다시 조회해 주세요.`
            : collectorFailure(error, "read"),
        });
    }
  }
  /** @param epoch 요청 시작 번호. 화면 재진입/종료 전의 응답인지 검사한다. */
  private current(epoch: number): boolean {
    return this.active && this.epoch === epoch;
  }
  /** 현재 화면에 속한 안내 타이머를 정리한다. 재진입/다른 성공 안내를 지우지 않게 한다. */
  private clearToastTimer(): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = null;
  }
  /** @param state 민감정보 없는 새 표시 상태. 구독자에게만 변경을 알린다. */
  private publish(state: CollectorSettingsState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}
