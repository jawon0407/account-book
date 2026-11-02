import { CollectorStateSchema, NotificationConsentStateSchema } from "@account-book/contracts";
import type { AccessScope, NotificationAccessPort } from "./notification-access";
import { CaptureSnapshotSchema, type CapturePort, type CaptureSnapshot } from "./android-capture";

type Api = { collectorState(): Promise<unknown>; notificationConsent(): Promise<unknown> };
type State = Readonly<{ phase: "stopped" | "stopping" | "checking" | "running" | "error"; result: CaptureSnapshot | null; notice: string | null }>;
/** 설정 화면 안에서만 판독한다. 상태 조회가 실패하면 짧은 네이티브 허용을 갱신하지 않는다. */
export class CollectionRuntime {
  private state: State = { phase: "stopped", result: null, notice: null };
  private listeners = new Set<() => void>();
  private run = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private scope: AccessScope | null = null;
  private nativeEpoch = -1;
  /** @param getScope 현재 로그인 경계 @param api 기존 인증 API @param access OS 상태 @param native 메모리 판독 경계 */
  constructor(private readonly getScope: () => AccessScope | null, private readonly api: Api,
    private readonly access: Pick<NotificationAccessPort, "getStatus">, private readonly native: CapturePort) {}
  snapshot = (): State => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** 팝업을 열 당시 계정/실행 경계를 캡처하여 오래된 확인 버튼의 재시작을 막는다. */
  prepareStart(): () => Promise<void> {
    const scope = this.getScope(); const run = this.run;
    return async () => { if (run === this.run && scope && this.sameScope(scope)) await this.start(); };
  }
  /** 명시적 사용자 확인 후 호출. 설정/동의의 허용만으로는 실행하지 않는다. */
  async start(): Promise<void> {
    if (this.state.phase === "running" || this.state.phase === "checking") return;
    const scope = this.getScope(); if (!scope) return;
    this.scope = { ...scope }; const run = ++this.run;
    this.publish({ phase: "checking", result: null, notice: null });
    try {
      const nativeEpoch = await this.bounded(this.native.begin());
      if (!this.current(run)) return;
      this.nativeEpoch = nativeEpoch;
      await this.verify(run);
    } catch { if (run === this.run) await this.fail(); }
  }
  /** 즉시 화면 자료를 지우고 네이티브 세대를 폐기한다. 실패해도 5초 허용 기한은 연장하지 않는다. */
  async stop(): Promise<void> {
    const run = ++this.run; clearTimeout(this.timer); this.timer = undefined; this.scope = null;
    this.publish({ phase: "stopping", result: null, notice: null });
    try {
      await this.bounded(this.native.stop());
      if (run === this.run) this.publish({ phase: "stopped", result: null, notice: null });
    }
    catch { if (run === this.run) this.publish({ phase: "error", result: null, notice: "중지 확인을 받지 못했어요. 화면을 닫아 주세요. 네이티브 판독 허용은 최대 5초 후 만료돼요." }); }
  }
  private async verify(run: number): Promise<void> {
    try {
      // Native fixes the deadline before any server request; queued renewals cannot extend it.
      const ticket = await this.bounded(this.native.beginVerification(this.nativeEpoch));
      if (!this.current(run)) return;
      const [rawCollector, rawConsent, os] = await this.bounded(Promise.all([
        this.api.collectorState(), this.api.notificationConsent(), this.access.getStatus(),
      ]));
      if (!this.current(run)) return;
      const collector = CollectorStateSchema.parse(rawCollector);
      const consent = NotificationConsentStateSchema.parse(rawConsent);
      if (collector.state !== "active_here" || consent.state !== "granted" || !os.available
        || !os.accessGranted || !os.listenerConnected) throw new Error("DENIED");
      if (!(await this.bounded(this.native.renew(this.nativeEpoch, ticket)))) throw new Error("STOPPED");
      if (!this.current(run)) return;
      const result = CaptureSnapshotSchema.parse(await this.bounded(this.native.snapshot()));
      if (!this.current(run)) return;
      if (!result.running) throw new Error("STOPPED");
      this.publish({ phase: "running", result, notice: null });
      // Two reads per cycle: at most 42 over a closed 60-second interval, leaving shared-budget headroom.
      this.timer = setTimeout(() => { void this.verify(run); }, 3000);
    } catch { if (run === this.run) await this.fail(); }
  }
  private sameScope(scope: AccessScope): boolean {
    const live = this.getScope();
    return !!live && live.origin === scope.origin && live.userId === scope.userId
      && live.deviceId === scope.deviceId && live.generation === scope.generation;
  }
  private current(run: number): boolean {
    if (run !== this.run) return false;
    if (!this.scope || !this.sameScope(this.scope)) { void this.stop(); return false; }
    return true;
  }
  private async fail(): Promise<void> {
    const stoppedRun = this.run + 1;
    await this.stop();
    if (stoppedRun !== this.run || this.state.phase === "error") return;
    this.publish({ phase: "error", result: null, notice: "판독을 중지했어요. 로그인·대표 기기·동의·알림 접근과 서버 연결을 확인한 뒤 다시 시작해 주세요. 구 APK는 재설치가 필요해요." });
  }
  private publish(state: State): void { this.state = state; this.listeners.forEach(listener => listener()); }
  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("TIMEOUT")), 2500);
    })]); } finally { clearTimeout(timeout); }
  }
}
