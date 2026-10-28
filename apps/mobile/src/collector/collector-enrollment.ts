import type { SessionManager } from "../auth/session-manager";
import { CollectorSettings } from "./collector-settings";
import {
  NotificationAccess,
  type AccessScope,
  type NotificationAccessPort,
} from "./notification-access";
import { consentPresentation } from "./notification-consent-copy";

type Port = Pick<
  SessionManager,
  | "collectorState"
  | "changeCollector"
  | "notificationConsent"
  | "changeNotificationConsent"
>;
type Intent = {
  scope: AccessScope;
  version: number;
  createdAt: number;
  opened: boolean;
};
type State = Readonly<{ busy: boolean; notice: string | null }>;
const MAX_WAIT_MS = 10 * 60 * 1000;

/** 동의/OS 확인 후 기기를 지정한다. 설정 왕복 의도만 메모리에 보관하며 알림은 읽지 않는다. */
export class CollectorEnrollment {
  public readonly access: NotificationAccess;
  public readonly settings: CollectorSettings;
  private state: State = { busy: false, notice: null };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private scope: AccessScope | null = null;
  private pending: Intent | null = null;

  /** @param getScope 검증된 로그인 경계. @param api 기존 서버 기능. @param native OS 조회/설정. @param now 만료 검사 시계. */
  public constructor(
    private readonly getScope: () => AccessScope | null,
    api: Port,
    native: NotificationAccessPort,
    private readonly now = Date.now,
  ) {
    this.access = new NotificationAccess(getScope, api, native);
    this.settings = new CollectorSettings(api);
  }
  public snapshot = (): State => this.state;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  /** 화면 복귀 시 항상 새로 조회한다. 이전에 명시적으로 시작한 OS 설정 왕복만 한 번 재개한다. */
  public async start(): Promise<void> {
    this.active = true;
    this.scope = this.getScope();
    const epoch = ++this.epoch,
      pending = this.pending;
    this.pending = null;
    this.publish(true);
    await Promise.all([this.access.start(), this.settings.start()]);
    if (!this.current(epoch)) return;
    if (pending) {
      const age = this.now() - pending.createdAt;
      if (
        sameScope(pending.scope, this.scope) &&
        pending.opened &&
        age >= 0 &&
        age <= MAX_WAIT_MS
      )
        await this.complete(epoch, pending);
      else
        this.publish(
          true,
          "기기 설정 시간이 지났거나 로그인 상태가 바뀌었어요. 알림 허용에서 다시 시작해 주세요.",
        );
    }
    if (this.current(epoch)) this.publish(false, this.state.notice);
  }
  /** background에서는 진행 중 응답을 무효화하되 OS 왕복 의도만 남긴다. 디스크에 저장하지 않는다. */
  public stop(): void {
    this.active = false;
    ++this.epoch;
    this.access.stop();
    this.settings.stop();
    this.publish(false);
  }
  /** 안내/새로고침만으로는 지정하지 않는다. 이전 미완료 의도도 자동 재시도하지 않는다. */
  public async reload(): Promise<void> {
    if (!this.active || this.state.busy) return;
    this.cancel();
    const epoch = ++this.epoch;
    this.publish(true);
    await Promise.all([this.access.reload(), this.settings.reload()]);
    if (this.current(epoch)) this.publish(false);
  }
  /** 명시적 동의 팝업의 확인에서만 호출한다. 권한이 이미 있으면 설정을 다시 열지 않는다. */
  public prepareAccessRequest(): () => Promise<void> {
    const epoch = this.epoch;
    // Native Alert가 화면보다 오래 남아도 표시 당시 경계에서만 확인을 사용할 수 있다.
    return async () => {
      if (this.current(epoch)) await this.requestAccess();
    };
  }
  /** 확인된 사용자 동작을 실행한다. UI는 prepareAccessRequest로 만든 일회성 경계를 사용한다. */
  public async requestAccess(): Promise<void> {
    if (
      !this.current(this.epoch) ||
      this.state.busy ||
      this.settings.snapshot().phase !== "ready"
    )
      return;
    const value = this.settings.snapshot().value;
    if (!value || this.settings.snapshot().confirmation) return;
    const intent: Intent = {
      scope: { ...this.scope! },
      version: value.version,
      createdAt: this.now(),
      opened: false,
    };
    const epoch = ++this.epoch;
    this.pending = null;
    this.publish(true);
    if (consentPresentation(this.access.snapshot()).canAccept)
      await this.access.accept();
    if (!this.current(epoch)) return;
    if (
      this.access.snapshot().phase !== "ready" ||
      this.access.snapshot().consent?.state !== "granted"
    ) {
      this.publish(
        false,
        "동의 저장을 확인하지 못해 기기를 지정하지 않았어요.",
      );
      return;
    }
    await this.access.reload();
    if (!this.current(epoch)) return;
    const access = this.access.snapshot();
    if (
      access.phase !== "ready" ||
      access.consent?.state !== "granted" ||
      !access.permission?.available
    ) {
      this.publish(
        false,
        "동의와 Android 접근을 확인하지 못해 기기를 지정하지 않았어요.",
      );
      return;
    }
    if (access.permission.accessGranted) {
      await this.settings.reload();
      if (this.current(epoch)) await this.complete(epoch, intent);
    } else {
      this.pending = intent;
      const opened = await this.access.openSettings();
      // 늦은 OS 실패도 같은 의도만 폐기한다. 새 작업을 지우거나 실패한 의도를 재개하지 않는다.
      if (this.pending === intent) {
        if (opened) intent.opened = true;
        else this.pending = null;
      }
    }
    if (this.current(epoch)) this.publish(false, this.state.notice);
  }
  /** 교체 확인 직전에 동의/OS를 다시 검사한다. 해제는 권한 없이도 할 수 있다. */
  public async confirm(): Promise<void> {
    const confirmation = this.settings.snapshot().confirmation;
    if (!this.current(this.epoch) || this.state.busy || !confirmation) return;
    const epoch = ++this.epoch;
    this.publish(true);
    if (confirmation.action === "activate") {
      await this.access.reload();
      if (!this.current(epoch)) return;
      if (!this.allowed()) {
        this.settings.cancel();
        this.publish(
          false,
          "동의와 Android 접근을 확인하지 못해 기존 기기를 유지했어요.",
        );
        return;
      }
    }
    await this.settings.confirm();
    if (this.current(epoch)) this.publish(false);
  }
  /** 명시적으로 화면을 떠나거나 교체를 취소하면 설정 왕복 의도를 버린다. */
  public cancel(): void {
    this.pending = null;
    this.settings.cancel();
  }
  /** 철회는 미완료 지정을 취소한 후 기존 서버 철회 경로로 처리한다. */
  public async withdraw(): Promise<void> {
    if (!this.current(this.epoch) || this.state.busy) return;
    this.cancel();
    const epoch = ++this.epoch;
    this.publish(true);
    await this.access.withdraw();
    if (this.current(epoch)) this.publish(false);
  }
  /** @param intent 사용자가 허용을 누를 때의 버전. 다른 기기 변경을 조용히 덮어쓰지 않는다. */
  private async complete(epoch: number, intent: Intent): Promise<void> {
    if (!this.current(epoch)) return;
    const settings = this.settings.snapshot();
    if (!this.allowed() || settings.phase !== "ready" || !settings.value) {
      this.publish(
        true,
        "동의와 Android 접근이 모두 확인되지 않아 기기 지정을 변경하지 않았어요.",
      );
      return;
    }
    if (settings.value.version !== intent.version) {
      this.publish(
        true,
        "설정 중 수집 기기 상태가 바뀌었어요. 알림 허용에서 다시 확인해 주세요.",
      );
      return;
    }
    if (settings.value.state === "active_here") return;
    this.settings.choose("activate");
    if (settings.value.state === "active_elsewhere") {
      this.publish(
        true,
        "다른 기기가 지정되어 있어요. 위의 기기 변경 안내를 확인해 주세요.",
      );
      return;
    }
    // 최초 허용 팝업에서 설명한 신규 지정. 기존 기기 교체는 위에서 별도 확인을 기다린다.
    await this.settings.confirm();
  }
  private allowed(): boolean {
    const access = this.access.snapshot();
    return (
      access.phase === "ready" &&
      access.consent?.state === "granted" &&
      access.permission?.available === true &&
      access.permission.accessGranted
    );
  }
  private current(epoch: number): boolean {
    return (
      this.active &&
      epoch === this.epoch &&
      sameScope(this.scope, this.getScope())
    );
  }
  private publish(busy: boolean, notice: string | null = null): void {
    this.state = { busy, notice };
    this.listeners.forEach((listener) => listener());
  }
}
/** 서버/계정/설치/로그인 세대가 같아야 설정 왕복 의도를 재사용한다. 토큰은 보관하지 않는다. */
function sameScope(a: AccessScope | null, b: AccessScope | null): boolean {
  return (
    !!a &&
    !!b &&
    a.origin === b.origin &&
    a.userId === b.userId &&
    a.deviceId === b.deviceId &&
    a.generation === b.generation
  );
}
