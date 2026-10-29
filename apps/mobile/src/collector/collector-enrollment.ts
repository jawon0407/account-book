import type { CollectorChangeInput } from "@account-book/contracts";
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
type State = Readonly<{ busy: boolean; notice: string | null }>;
type CollectorDialog = Readonly<{
  confirmation: CollectorChangeInput;
  confirm: () => Promise<void>;
  cancel: () => void;
}>;

/** 동의·OS 접근과 대표 기기 지정을 독립적으로 관리한다. 권한 허용/복귀로는 지정하지 않는다. */
export class CollectorEnrollment {
  public readonly access: NotificationAccess;
  public readonly settings: CollectorSettings;
  private state: State = { busy: false, notice: null };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private scope: AccessScope | null = null;

  /** @param getScope 현재 검증된 로그인 경계. @param api 서버의 두 독립 설정 API. @param native OS 조회/설정 이동만 제공하는 어댑터. */
  public constructor(
    private readonly getScope: () => AccessScope | null,
    api: Port,
    native: NotificationAccessPort,
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
  /** 화면 복귀 시 조회만 실행한다. 자동 지정용 의도를 저장하거나 재개하지 않는다. */
  public async start(): Promise<void> {
    this.active = true;
    this.scope = this.getScope();
    const epoch = ++this.epoch;
    this.publish(true);
    await Promise.all([this.access.start(), this.settings.start()]);
    if (this.current(epoch)) this.publish(false);
  }
  /** 화면/계정 경계를 넘는 응답과 토스트를 폐기한다. */
  public stop(): void {
    this.active = false;
    ++this.epoch;
    this.access.stop();
    this.settings.stop();
    this.publish(false);
  }
  public async reload(): Promise<void> {
    if (!this.current(this.epoch) || this.state.busy) return;
    this.cancel();
    const epoch = ++this.epoch;
    this.publish(true);
    await Promise.all([this.access.reload(), this.settings.reload()]);
    if (this.current(epoch)) this.publish(false);
  }
  /** Native Alert의 늦은 확인이 다른 화면/계정에 적용되지 않게 당시 세대를 고정한다. */
  public prepareAccessRequest(): () => Promise<void> {
    const epoch = this.epoch;
    return async () => {
      if (this.current(epoch)) await this.requestAccess();
    };
  }
  /** 거부 확인도 허용 확인과 동일한 세션/화면 경계 검사를 적용한다. */
  public prepareWithdrawal(): () => Promise<void> {
    const epoch = this.epoch;
    return async () => {
      if (this.current(epoch)) await this.withdraw();
    };
  }
  /** @param action 지정/교체 또는 해제. 팝업의 확인·취소를 당시 요청과 로그인 경계에 고정한다. */
  public prepareCollectorChange(
    action: CollectorChangeInput["action"],
  ): CollectorDialog | null {
    if (
      !this.current(this.epoch) ||
      this.state.busy ||
      this.settings.snapshot().confirmation
    )
      return null;
    this.settings.choose(action);
    const confirmation = this.settings.snapshot().confirmation;
    if (!confirmation) return null;
    const epoch = this.epoch;
    const current = () =>
      this.current(epoch) &&
      this.settings.snapshot().confirmation === confirmation;
    return {
      confirmation,
      confirm: async () => {
        if (current()) await this.confirm();
      },
      cancel: () => {
        if (current()) this.cancel();
      },
    };
  }
  /** 동의를 저장하고 필요한 경우 OS 설정만 연다. 대표 기기 API는 호출하지 않는다. */
  public async requestAccess(): Promise<void> {
    if (!this.current(this.epoch) || this.state.busy) return;
    this.cancel();
    const epoch = ++this.epoch;
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
        "동의 저장을 확인하지 못했어요. 상태를 다시 확인해 주세요.",
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
        "동의와 Android 접근을 확인하지 못했어요. 상태를 다시 확인해 주세요.",
      );
      return;
    }
    if (!access.permission.accessGranted) await this.access.openSettings();
    if (this.current(epoch)) this.publish(false);
  }
  /** 별도 지정 버튼에서 확인한 작업만 실행한다. 해제는 동의/OS 접근 없이도 가능하다. */
  public async confirm(): Promise<void> {
    const confirmation = this.settings.snapshot().confirmation;
    if (!this.current(this.epoch) || this.state.busy || !confirmation) return;
    const epoch = ++this.epoch;
    this.publish(true);
    if (confirmation.action === "activate") {
      await this.access.reload();
      if (!this.current(epoch)) return;
      const access = this.access.snapshot();
      if (
        access.phase !== "ready" ||
        access.consent?.state !== "granted" ||
        !access.permission?.available ||
        !access.permission.accessGranted
      ) {
        this.settings.cancel();
        this.publish(
          false,
          "먼저 아래 ‘알림 허용’에서 동의와 Android 접근을 확인해 주세요. 기존 기기 지정은 바꾸지 않았어요.",
        );
        return;
      }
    }
    await this.settings.confirm();
    if (this.current(epoch)) this.publish(false);
  }
  /** 아직 저장하지 않은 기기 지정/교체 확인만 취소한다. */
  public cancel(): void {
    this.settings.cancel();
  }
  /** 서버 동의를 철회하고 남아 있는 OS 접근을 직접 끌 수 있게 한다. 실패 시에도 OS 해제 경로를 보존한다. */
  public async withdraw(): Promise<void> {
    if (!this.current(this.epoch) || this.state.busy) return;
    this.cancel();
    const epoch = ++this.epoch;
    this.publish(true);
    if (consentPresentation(this.access.snapshot()).canWithdraw)
      await this.access.withdraw();
    if (!this.current(epoch)) return;
    const access = this.access.snapshot();
    if (
      access.permission?.accessGranted &&
      consentPresentation(access).canOpenSettings
    )
      await this.access.openSettings();
    if (this.current(epoch)) this.publish(false);
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
  private publish(busy: boolean, notice: string | null = null): void {
    this.state = { busy, notice };
    this.listeners.forEach((listener) => listener());
  }
}
