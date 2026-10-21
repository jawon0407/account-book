import type { Profile } from "@account-book/contracts";
import { ClientError, type ClientErrorCode } from "../api/client-error";
import type { SessionManager, SessionState } from "../auth/session-manager";
import { ManualEntry } from "./manual-entry";
import {
  buildManualInput,
  type ManualContext,
  type ManualDraft,
} from "./manual-input";

type Api = Pick<
  SessionManager,
  "profile" | "updateProfile" | "accounts" | "categories" | "createTransaction"
>;
type Screen = "ledger" | "manual" | "residence" | "collector";
type State = Readonly<{
  ownerId: string | null;
  screen: Screen;
  entry: ManualEntry | null;
  draft: ManualDraft | null;
  context: ManualContext | null;
  profile: Profile | null;
  loading: boolean;
  error: ClientErrorCode | null;
  listVersion: number;
  listChecked: boolean;
}>;
const empty = (): State => ({
  ownerId: null,
  screen: "ledger",
  entry: null,
  draft: null,
  context: null,
  profile: null,
  loading: false,
  error: null,
  listVersion: 0,
  listChecked: false,
});

/** 화면 수명과 분리한 계정 전용 메모리. background에서는 보존하고 로그아웃 시 폐기한다. */
export class ManualWorkspace {
  private state = empty();
  private ready = false;
  private epoch = 0;
  private navigationEpoch = 0;
  private pending: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private detachEntry: (() => void) | null = null;
  /** @param api 토큰 없는 인증 API. 나머지 인자는 UUID·오늘 날짜·제안 시간대 공급 함수다. */
  public constructor(
    private readonly api: Api,
    private readonly createKey: () => string,
    private readonly today: () => string,
    private readonly suggestedZone: () => string,
  ) {}
  public snapshot = (): State => this.state;
  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private blank(): ManualDraft {
    return {
      type: "expense",
      amount: "",
      date: this.today(),
      clock: "",
      sourceTimeZone: this.suggestedZone(),
      timeChoice: null,
      accountId: null,
      categoryId: null,
      counterpartyName: "",
      memo: "",
    };
  }
  /** @param session 인증 상태. verifying/unavailable만 같은 계정 초안을 보존한다. */
  public acceptSession(session: SessionState): void {
    if (session.status !== "ready") {
      this.ready = false;
      this.epoch++;
      this.pending = null;
      if (!["verifying", "unavailable"].includes(session.status)) this.clear();
      else this.publish({ context: null, loading: false });
      return;
    }
    if (session.userId !== this.state.ownerId) {
      this.clear();
      const entry = new ManualEntry(
        (input) => this.api.createTransaction(input),
        this.createKey,
      );
      this.publish({ ownerId: session.userId, entry, draft: this.blank() });
      this.detachEntry = entry.subscribe(() =>
        this.publish(
          entry.snapshot().status === "saving" ? { listChecked: false } : {},
        ),
      );
    }
    this.ready = true;
  }
  /** 현재 계정의 선택 목록/거주 기준을 재조회한다. 늦은 결과는 epoch로 폐기한다. */
  public load(): Promise<void> {
    if (!this.ready || !this.state.ownerId) return Promise.resolve();
    if (this.pending) return this.pending;
    const epoch = this.epoch,
      owner = this.state.ownerId;
    this.publish({ loading: true, error: null, context: null });
    const pending = (async () => {
      try {
        const [profile, accounts, categories] = await Promise.all([
          this.api.profile(),
          this.api.accounts(),
          this.api.categories(),
        ]);
        if (epoch !== this.epoch || !this.ready || owner !== this.state.ownerId)
          return;
        if (profile.id !== owner) throw new ClientError("INVALID_RESPONSE");
        this.publish({
          profile,
          context: {
            accounts: accounts.items,
            categories: categories.items,
            ledgerTimeZone: profile.ledgerTimeZone ?? null,
          },
          loading: false,
        });
      } catch (cause) {
        if (epoch === this.epoch && this.ready)
          this.publish({
            loading: false,
            error: cause instanceof ClientError ? cause.code : "UNAVAILABLE",
          });
      }
    })();
    this.pending = pending;
    void pending.finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    return pending;
  }
  /** @param patch 바뀐 화면 값. 저장 중/결과 불명에는 원래 요청의 내용을 잠근다. */
  public edit(patch: Partial<ManualDraft>): boolean {
    const { entry, draft } = this.state;
    if (
      !this.ready ||
      !draft ||
      !entry ||
      !["editing", "failed"].includes(entry.snapshot().status)
    )
      return false;
    this.publish({
      draft: {
        ...draft,
        ...patch,
        ...(patch.type && patch.type !== draft.type
          ? { categoryId: null }
          : {}),
        ...(patch.date !== undefined ||
        patch.clock !== undefined ||
        patch.sourceTimeZone !== undefined
          ? { timeChoice: null }
          : {}),
      },
    });
    return true;
  }
  /** @param screen 이동 대상. 완료된 기록은 새 입력을 명시적으로 열 때에만 초기화한다. */
  public open(screen: Screen): void {
    if (!this.ready) return;
    this.navigationEpoch++;
    if (
      screen === "manual" &&
      this.state.entry?.snapshot().status === "saved"
    ) {
      this.state.entry.beginNew();
      this.publish({ draft: this.blank() });
    }
    this.publish({ screen });
  }
  /** 검증된 초안을 한 번 전송하며 성공한 경우에만 목록 재조회 버전을 올린다. */
  public async submit(): Promise<void> {
    const { entry, draft, context } = this.state;
    if (!this.ready || !entry || !draft || !context)
      throw new ClientError("UNAVAILABLE");
    const input = buildManualInput(draft, context);
    await entry.submit(input);
    if (this.state.entry === entry && this.ready)
      this.publish({
        screen: "ledger",
        listVersion: this.state.listVersion + 1,
        listChecked: false,
      });
  }
  /** 결과 불명 상태의 동일 요청만 재시도한다. */
  public async retry(): Promise<void> {
    const entry = this.state.entry;
    if (!this.ready || !entry) throw new ClientError("SESSION_CHANGED");
    await entry.retry();
    if (this.state.entry === entry && this.ready)
      this.publish({
        screen: "ledger",
        listVersion: this.state.listVersion + 1,
        listChecked: false,
      });
  }
  /** 목록 요청 시작 당시 이미 결과 불명이었던 상태 객체를 확인 표식으로 잡는다. */
  public beginListCheck(): object | null {
    const state = this.state.entry?.snapshot();
    return this.ready && state?.status === "uncertain" ? state : null;
  }
  /** 실제 목록 조회 성공 후 호출한다. 불확실한 저장이 생기기 전의 조회는 인정하지 않는다. */
  public markListChecked(receipt: object | null): void {
    if (receipt !== null && receipt === this.beginListCheck())
      this.publish({ listChecked: true });
  }
  /** 목록 확인+중복 위험 안내에 사용자가 동의했을 때만 새로운 시도를 허용한다. */
  public resetAfterListCheck(): boolean {
    if (
      !this.ready ||
      !this.state.listChecked ||
      this.state.entry?.snapshot().status !== "uncertain"
    )
      return false;
    this.state.entry.confirmListChecked();
    this.publish({ draft: this.blank(), listChecked: false, screen: "manual" });
    return true;
  }
  /** @param ledgerTimeZone 사용자가 확인한 거주 기준. 기기 시간대를 자동 저장하지 않는다. */
  public async setResidence(ledgerTimeZone: string): Promise<void> {
    const { profile, ownerId } = this.state,
      epoch = this.epoch,
      navigationEpoch = this.navigationEpoch;
    if (!this.ready || !profile) throw new ClientError("UNAVAILABLE");
    try {
      await this.api.updateProfile({
        ledgerTimeZone,
        expectedVersion: profile.version,
      });
      if (epoch !== this.epoch || ownerId !== this.state.ownerId || !this.ready)
        throw new ClientError("SESSION_CHANGED");
    } finally {
      if (epoch === this.epoch && ownerId === this.state.ownerId && this.ready)
        await this.load();
    }
    if (epoch !== this.epoch || ownerId !== this.state.ownerId || !this.ready)
      throw new ClientError("SESSION_CHANGED");
    if (
      navigationEpoch === this.navigationEpoch &&
      this.state.screen === "residence"
    )
      this.open("manual");
  }
  /** 앱/계정 종료. 서버에 이미 전송한 쓰기까지 취소하지는 않는다. */
  public dispose(): void {
    this.ready = false;
    this.clear();
    this.listeners.clear();
  }
  private clear(): void {
    this.epoch++;
    this.pending = null;
    this.detachEntry?.();
    this.detachEntry = null;
    this.state.entry?.dispose();
    this.state = empty();
    this.listeners.forEach((listener) => listener());
  }
}
