import type { SessionStorage } from "../auth/session-persistence";
import {
  NotificationConsentStore,
  type ConsentScope,
  type ConsentRecord,
} from "./notification-consent";

export type AccessScope = ConsentScope & { generation: number };
export type PermissionStatus = Readonly<{
  available: boolean;
  accessGranted: boolean;
  listenerConnected: boolean;
}>;
export type NotificationAccessPort = {
  getStatus(): Promise<PermissionStatus>;
  openSettings(): Promise<boolean>;
};
export type AccessState = Readonly<{
  phase: "idle" | "loading" | "ready" | "saving" | "error";
  consent: ConsentRecord | null;
  permission: PermissionStatus | null;
  notice: string | null;
}>;
const empty = (): AccessState => ({
  phase: "idle",
  consent: null,
  permission: null,
  notice: null,
});

/** 동의와 OS 상태를 따로 관리한다. 실제 금융 알림 수집 기능은 제공하지 않는다. */
export class NotificationAccess {
  private state = empty();
  private active = false;
  private epoch = 0;
  private scope: AccessScope | null = null;
  private listeners = new Set<() => void>();
  /** @param getScope 현재 검증 세션. @param storage 보안 저장소. @param native OS 접근 상태/설정 이동만 제공하는 어댑터. */
  public constructor(
    private readonly getScope: () => AccessScope | null,
    private readonly storage: SessionStorage,
    private readonly native: NotificationAccessPort,
  ) {}
  public snapshot = (): AccessState => this.state;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  public async start(): Promise<void> {
    this.active = true;
    this.scope = this.getScope();
    await this.load();
  }
  public stop(): void {
    this.active = false;
    ++this.epoch;
    this.publish(empty());
  }
  public async reload(): Promise<void> {
    if (this.active && !this.busy()) await this.load();
  }
  /** 명시적 UI 확인 후 호출한다. 동의를 저장해도 OS 권한을 요청하거나 자동 기록하지 않는다. */
  public accept(): Promise<void> {
    return this.change("accept");
  }
  public withdraw(): Promise<void> {
    return this.change("withdraw");
  }
  /** 동의가 없으면 허용 요청을 막는다. 이미 켜진 OS 접근을 끄기 위한 이동은 허용한다. */
  public async openSettings(): Promise<void> {
    if (
      !this.usable() ||
      !this.state.permission?.available ||
      (!this.state.consent && !this.state.permission.accessGranted)
    )
      return;
    const epoch = ++this.epoch;
    this.publish({ ...this.state, phase: "saving", notice: null });
    try {
      const opened = await this.native.openSettings();
      if (this.current(epoch))
        this.publish({
          ...this.state,
          phase: "ready",
          notice: opened
            ? "Android 설정에서 직접 선택해 주세요. 돌아오면 실제 상태를 다시 확인해요."
            : "Android 알림 접근 설정을 열지 못했어요. 휴대폰 설정에서 직접 확인해 주세요.",
        });
    } catch {
      if (this.current(epoch)) this.fail();
    }
  }
  private async change(action: "accept" | "withdraw"): Promise<void> {
    if (!this.usable()) return;
    const epoch = ++this.epoch;
    this.publish({
      ...this.state,
      phase: "saving",
      consent: null,
      notice: null,
    });
    try {
      const store = new NotificationConsentStore(this.storage, this.scope!);
      const consent =
        action === "accept"
          ? await store.accept(new Date().toISOString())
          : (await store.withdraw(), null);
      if (!this.current(epoch)) return;
      this.publish({
        ...this.state,
        phase: "ready",
        consent,
        notice:
          action === "accept"
            ? "이 계정의 동의를 이 휴대폰에 저장했어요. 자동 기록은 아직 시작되지 않아요."
            : "이 휴대폰의 동의를 철회했어요. OS 알림 접근은 아래에서 별도로 해제할 수 있어요.",
      });
    } catch {
      if (this.current(epoch)) this.fail();
    }
  }
  private async load(): Promise<void> {
    const epoch = ++this.epoch;
    this.publish({ ...empty(), phase: "loading" });
    if (!this.scope || !this.current(epoch)) {
      if (this.active) this.fail();
      return;
    }
    try {
      const [consent, permission] = await Promise.all([
        new NotificationConsentStore(this.storage, this.scope).read(),
        this.native.getStatus(),
      ]);
      if (this.current(epoch))
        this.publish({ phase: "ready", consent, permission, notice: null });
    } catch {
      if (this.current(epoch)) this.fail();
    }
  }
  private busy(): boolean {
    return this.state.phase === "loading" || this.state.phase === "saving";
  }
  private usable(): boolean {
    return (
      this.active && this.state.phase === "ready" && this.current(this.epoch)
    );
  }
  private current(epoch: number): boolean {
    const now = this.getScope(),
      before = this.scope;
    return (
      this.active &&
      epoch === this.epoch &&
      !!now &&
      !!before &&
      now.origin === before.origin &&
      now.userId === before.userId &&
      now.deviceId === before.deviceId &&
      now.generation === before.generation
    );
  }
  private fail(): void {
    this.publish({
      ...empty(),
      phase: "error",
      notice:
        "동의 또는 권한 상태를 확인하지 못했어요. 저장·철회가 완료되지 않았을 수 있어요. 다시 조회해 주세요.",
    });
  }
  private publish(state: AccessState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}
