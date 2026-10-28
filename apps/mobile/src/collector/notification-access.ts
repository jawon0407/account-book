import {
  NOTIFICATION_NOTICE_VERSION,
  type NotificationConsentChangeInput,
  type NotificationConsentState,
} from "@account-book/contracts";
import { ClientError } from "../api/client-error";
import type { ConsentScope } from "./notification-consent";
import { consentPresentation } from "./notification-consent-copy";

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
export type NotificationConsentPort = {
  notificationConsent(): Promise<NotificationConsentState>;
  changeNotificationConsent(
    input: NotificationConsentChangeInput,
  ): Promise<NotificationConsentState>;
};
export type AccessState = Readonly<{
  phase: "idle" | "loading" | "ready" | "saving" | "error";
  consent: NotificationConsentState | null;
  permission: PermissionStatus | null;
  notice: string | null;
}>;
const empty = (): AccessState => ({
  phase: "idle",
  consent: null,
  permission: null,
  notice: null,
});

/** 서버 동의와 OS 상태를 독립적으로 확인한다. 알림 본문 수집·업로드 경로는 없다. */
export class NotificationAccess {
  private state = empty();
  private active = false;
  private epoch = 0;
  private scope: AccessScope | null = null;
  private failedAction: "accept" | "withdraw" | null = null;
  private listeners = new Set<() => void>();
  /** @param getScope 검증된 현재 세션. @param server 세션에 결속된 동의 API. @param native OS 조회/설정 이동만 제공한다. */
  public constructor(
    private readonly getScope: () => AccessScope | null,
    private readonly server: NotificationConsentPort,
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
    this.failedAction = null;
    await this.load();
  }
  public stop(): void {
    this.active = false;
    ++this.epoch;
    this.failedAction = null;
    this.publish(empty());
  }
  /** 사용자가 재조회할 때 GET만 실행한다. 실패한 동의/철회 PATCH는 자동 재전송하지 않는다. */
  public async reload(): Promise<void> {
    if (this.active && !consentPresentation(this.state).busy) await this.load();
  }
  /** 명시적으로 고지를 확인한 뒤 호출한다. 저장 성공도 OS 허용이나 자동 기록 시작을 뜻하지 않는다. */
  public async accept(): Promise<void> {
    await this.change("accept");
  }
  public async withdraw(): Promise<void> {
    await this.change("withdraw");
  }
  /** 팝업에서 명시적으로 동의한 뒤 호출한다. 저장 성공을 검증한 같은 작업에서만 OS 설정을 연다. */
  public async requestAccess(): Promise<void> {
    const presentation = consentPresentation(this.state);
    if (!this.current(this.epoch) || presentation.busy) return;
    const epoch = presentation.canAccept
      ? await this.change("accept")
      : this.state.consent?.state === "granted"
        ? this.epoch
        : null;
    if (epoch !== null && this.current(epoch)) await this.openSettings();
  }
  /** 서버 장애 중에도 이미 켜진 OS 접근을 끄기 위한 이동은 막지 않는다. */
  public async openSettings(): Promise<boolean> {
    if (
      !this.current(this.epoch) ||
      !consentPresentation(this.state).canOpenSettings
    )
      return false;
    const epoch = ++this.epoch,
      before = this.state;
    this.publish({ ...before, phase: "saving" });
    let opened = false;
    try {
      opened = await this.native.openSettings();
    } catch {
      /* 시스템 오류 내용은 화면에 노출하지 않는다. */
    }
    if (!this.current(epoch)) return opened;
    const notice = opened
      ? "Android 설정에서 직접 선택해 주세요. 돌아오면 실제 상태를 다시 확인해요."
      : "Android 알림 접근 설정을 열지 못했어요. 휴대폰 설정에서 직접 확인해 주세요.";
    this.publish({
      ...before,
      notice:
        before.phase === "error"
          ? `${before.notice ?? "서버 동의는 확인하지 못했어요."} ${notice}`
          : notice,
    });
    return opened;
  }
  /** @param action 사용자 확인을 마친 동작. 조회 버전과 응답 버전을 대조하여 덮어쓰기를 방지한다. */
  private async change(action: "accept" | "withdraw"): Promise<number | null> {
    const presentation = consentPresentation(this.state);
    if (
      !this.current(this.epoch) ||
      !(action === "accept" ? presentation.canAccept : presentation.canWithdraw)
    )
      return null;
    const expectedVersion = this.state.consent!.version,
      epoch = ++this.epoch;
    this.publish({
      ...this.state,
      phase: "saving",
      consent: null,
      notice: null,
    });
    try {
      const input: NotificationConsentChangeInput =
        action === "accept"
          ? {
              action,
              expectedVersion,
              noticeVersion: NOTIFICATION_NOTICE_VERSION,
            }
          : { action, expectedVersion };
      const consent = await this.server.changeNotificationConsent(input);
      if (!this.current(epoch)) return null;
      if (
        consent.version !== expectedVersion + 1 ||
        consent.state !== (action === "accept" ? "granted" : "withdrawn") ||
        consent.noticeVersion !== NOTIFICATION_NOTICE_VERSION
      )
        throw new ClientError("INVALID_RESPONSE");
      this.failedAction = null;
      this.publish({
        ...this.state,
        phase: "ready",
        consent,
        notice:
          action === "accept"
            ? "현재 계정·설치의 동의를 서버에 저장했어요. 자동 기록은 아직 시작되지 않아요."
            : "현재 계정·설치의 동의를 서버에서 철회했어요. Android 알림 접근은 별도로 해제할 수 있어요.",
      });
      return epoch;
    } catch (error) {
      if (!this.current(epoch)) return null;
      this.failedAction = action;
      this.fail(
        error instanceof ClientError &&
          error.code === "COLLECTOR_VERSION_CONFLICT"
          ? "서버의 동의 상태가 바뀌었어요. 동의·철회 요청을 다시 보내지 않았어요. 상태를 다시 조회한 뒤 선택해 주세요."
          : "동의·철회 결과를 확인하지 못했어요. 완료되지 않았을 수 있어요. 자동 재전송하지 않으니 상태를 다시 조회해 주세요.",
      );
      return null;
    }
  }
  private async load(): Promise<void> {
    const epoch = ++this.epoch;
    this.publish({ ...empty(), phase: "loading" });
    if (!this.scope || !this.current(epoch)) {
      if (this.active) this.fail();
      return;
    }
    // 둘 중 하나의 오류가 다른 상태를 지우지 않게 한다. 서버 실패 시에도 OS 해제 경로를 남긴다.
    const [remote, os] = await Promise.allSettled([
      this.server.notificationConsent(),
      this.native.getStatus(),
    ]);
    if (!this.current(epoch)) return;
    const permission = os.status === "fulfilled" ? os.value : null;
    if (remote.status === "rejected") {
      this.publish({
        ...empty(),
        phase: "error",
        permission,
        notice:
          "서버 동의 상태를 확인하지 못했어요. 상태를 다시 조회해 주세요. Android 권한은 별도로 확인할 수 있어요.",
      });
      return;
    }
    const consent = remote.value;
    const withdrawalStillNeeded =
      this.failedAction === "withdraw" &&
      ["granted", "outdated"].includes(consent.state);
    this.failedAction = withdrawalStillNeeded ? "withdraw" : null;
    this.publish({
      phase: "ready",
      consent,
      permission,
      notice: withdrawalStillNeeded
        ? "서버에 동의가 남아 있어요. 철회를 원하면 내용을 확인하고 다시 철회해 주세요."
        : permission
          ? null
          : "Android 권한을 확인하지 못했어요. 서버 동의는 확인됐으며 필요하면 철회할 수 있어요.",
    });
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
  private fail(
    notice = "서버 동의를 확인하지 못했어요. 상태를 다시 조회해 주세요.",
  ): void {
    this.publish({ ...this.state, phase: "error", consent: null, notice });
  }
  private publish(state: AccessState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}
