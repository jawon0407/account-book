import {
  NativeAuthResponseSchema,
  type NativeAuthResponse,
  type NativeSession,
  type CreateTransactionInput,
  type UpdateProfileInput,
  type Profile,
  type CollectorChangeInput,
} from "@account-book/contracts";
import type { NativeClient } from "../api/native-client";
import { ClientError } from "../api/client-error";
import { SessionPersistence, type SessionStorage } from "./session-persistence";
export {
  SESSION_KEY,
  DEVICE_KEY,
  type SessionStorage,
} from "./session-persistence";
export type SessionState = Readonly<
  | {
      status:
        | "starting"
        | "signed_out"
        | "busy"
        | "verifying"
        | "storage_error"
        | "unavailable";
    }
  | { status: "ready"; userId: string }
>;
type Client = Pick<
  NativeClient,
  | "origin"
  | "signIn"
  | "session"
  | "refresh"
  | "signOut"
  | "transactions"
  | "ledger"
  | "collector"
>;

/** 인증 변경을 한 줄로 실행한다. 공개 상태에는 credential이나 거래 데이터가 없다. */
export class SessionManager {
  private state: SessionState = { status: "starting" };
  private credential: NativeAuthResponse | null = null;
  private deviceId: string | null = null;
  private generation = 0;
  private verificationEpoch = 0;
  private pendingRevocations = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private readonly persistence: SessionPersistence;
  /** @param client native BFF 호출. @param storage OS 보안 저장소. @param createDeviceId 암호학적 UUID 생성기. */
  public constructor(
    private readonly client: Client,
    storage: SessionStorage,
    createDeviceId: () => string,
  ) {
    this.persistence = new SessionPersistence(
      storage,
      client.origin,
      createDeviceId,
    );
  }
  /** UI에 공개 가능한 상태만 반환하며 credential은 포함하지 않는다. */
  public snapshot = (): SessionState => this.state;
  /** 로컬 동의를 현재 서버·회원·설치에 결속한다. 비밀 토큰은 반환하지 않는다. */
  public notificationConsentScope() {
    if (this.state.status !== "ready" || !this.credential || !this.deviceId)
      return null;
    return {
      origin: this.client.origin,
      userId: this.credential.session.userId,
      deviceId: this.deviceId,
      generation: this.generation,
    };
  }
  /** @param listener 상태 변경 시 UI를 갱신한다. 반환 함수로 구독을 제거한다. */
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 재실행 시 저장된 세션을 서버에서 확인한다. 서버 확인 전에는 장부를 공개하지 않는다. */
  public restore(): Promise<void> {
    const generation = ++this.generation;
    const epoch = ++this.verificationEpoch;
    this.credential = null;
    this.publish({ status: "starting" });
    return this.serial(async () => {
      try {
        this.check(generation);
        const saved = await this.persistence.load();
        this.check(generation);
        this.deviceId = saved.deviceId;
        if (!saved.credential) {
          if (saved.needsCleanup) await this.clear();
          else this.publish({ status: "signed_out" });
          return;
        }
        this.credential = saved.credential;
      } catch {
        if (generation !== this.generation) return;
        this.credential = null;
        this.publish({ status: "storage_error" });
        return;
      }
      try {
        await this.validate(generation);
        this.check(generation);
        if (epoch === this.verificationEpoch && this.credential)
          this.publish({
            status: "ready",
            userId: this.credential.session.userId,
          });
      } catch {
        // validate가 만료/철회를 정리했다면 그 결과를 보존한다. 통신 실패만 재연결 상태로 둔다.
        if (
          generation === this.generation &&
          epoch === this.verificationEpoch &&
          this.credential
        )
          this.publish({ status: "unavailable" });
      }
    });
  }
  /** @param email 입력 이메일. @param password 요청 후 저장하지 않는 비밀번호. */
  public signIn(email: string, password: string): Promise<void> {
    if (this.state.status === "storage_error")
      return Promise.reject(new ClientError("STORAGE"));
    if (this.state.status !== "signed_out" || !this.deviceId)
      return Promise.reject(new ClientError("SESSION_CHANGED"));
    const generation = ++this.generation;
    this.publish({ status: "busy" });
    return this.serial(async () => {
      try {
        this.check(generation);
        await this.save(
          await this.client.signIn({
            email,
            password,
            deviceId: this.deviceId!,
          }),
          generation,
        );
      } catch (error) {
        if (
          generation === this.generation &&
          this.state.status !== "storage_error"
        )
          this.publish({ status: "signed_out" });
        throw error;
      }
    });
  }
  /** foreground 복귀 때 서버 상태를 확인한다. refresh는 큐 안에서 한 번씩만 실행된다. */
  public revalidate(): Promise<void> {
    const generation = this.generation;
    const epoch = ++this.verificationEpoch;
    if (!this.credential)
      return Promise.reject(new ClientError("AUTH_SESSION_EXPIRED"));
    this.publish({ status: "verifying" });
    return this.serial(async () => {
      try {
        await this.validate(generation);
        if (epoch === this.verificationEpoch && this.credential)
          this.publish({
            status: "ready",
            userId: this.credential.session.userId,
          });
      } catch (error) {
        if (
          generation === this.generation &&
          epoch === this.verificationEpoch &&
          this.credential
        )
          this.publish({ status: "unavailable" });
        throw error;
      }
    });
  }

  /** logout은 즉시 UI를 가리고, 갱신 요청 뒤 새 토큰까지 폐기한다. 저장 실패는 차단 상태다. */
  public signOut(): Promise<void> {
    ++this.generation;
    ++this.verificationEpoch;
    this.publish({ status: "busy" });
    return this.serial(async () => {
      if (this.credential)
        this.pendingRevocations.add(this.credential.sessionToken);
      const removal = this.clear();
      await this.revokePending();
      await removal;
    });
  }
  /** @param cursor 다음 페이지. 로그아웃/계정 전환 전 시작한 응답은 반환하지 않는다. */
  public transactions(cursor?: string) {
    return this.authenticatedRequest((token) =>
      this.client.transactions(token, cursor),
    );
  }
  /** 현재 로그인 세션 기준 수집 기기 지정 상태. 토큰을 화면에 반환하지 않는다. */
  public collectorState() {
    return this.authenticatedRequest((token) =>
      this.client.collector.read(token),
    );
  }
  /** @param input 화면에서 확인한 지정/해제와 기대 버전. 세션 변경 후 응답은 폐기한다. */
  public changeCollector(input: CollectorChangeInput) {
    return this.authenticatedRequest((token) =>
      this.client.collector.change(token, input),
    );
  }
  /** 현재 로그인 사용자의 프로필만 반환한다. HTTP schema와 별도로 사용자 ID를 대조한다. */
  public async profile() {
    return this.authenticatedRequest(async (token) =>
      this.ownProfile(await this.client.ledger.profile(token)),
    );
  }
  /** @param input 선택한 닉네임/거주 기준과 expectedVersion. 충돌/실패를 자동 재전송하지 않는다. */
  public async updateProfile(input: UpdateProfileInput) {
    return this.authenticatedRequest(async (token) =>
      this.ownProfile(await this.client.ledger.updateProfile(token, input)),
    );
  }
  /** 현재 계정의 활성 장부 계좌. 토큰은 UI로 노출하지 않는다. */
  public accounts() {
    return this.authenticatedRequest((token) =>
      this.client.ledger.accounts(token),
    );
  }
  /** 현재 계정의 활성 수입/지출 분류. 신규 입력에서 방향별 선택은 입력 모델이 처리한다. */
  public categories() {
    return this.authenticatedRequest((token) =>
      this.client.ledger.categories(token),
    );
  }
  /** @param input 사용자 입력과 고정 멱등 키. 응답 유실 후 재시도 결정은 저장 시도 모델의 책임이다. */
  public createTransaction(input: CreateTransactionInput) {
    return this.authenticatedRequest((token) =>
      this.client.ledger.createTransaction(token, input),
    );
  }
  /** @param value strict 검증된 프로필. 다른 사용자 응답을 정상 화면 자료로 채택하지 않는다. */
  private ownProfile(value: Profile): Profile {
    if (value.id !== this.credential?.session.userId)
      throw new ClientError("INVALID_RESPONSE");
    return value;
  }
  /** @param operation 토큰이 필요한 고정 API 작업. 읽기/쓰기 모두 같은 세대·401 보호를 적용한다. */
  private async authenticatedRequest<T>(
    operation: (token: string) => Promise<T>,
  ): Promise<T> {
    const generation = this.generation;
    const epoch = this.verificationEpoch;
    const checkRequest = () => {
      this.check(generation);
      if (epoch !== this.verificationEpoch)
        throw new ClientError("SESSION_CHANGED");
    };
    const token = await this.serial(async () => {
      this.check(generation);
      if (!this.credential || this.state.status !== "ready")
        throw new ClientError("AUTH_SESSION_EXPIRED");
      if (Date.parse(this.credential.session.refreshAt) <= Date.now())
        await this.rotate(generation);
      this.check(generation);
      return this.credential!.sessionToken;
    });
    try {
      checkRequest();
      const result = await operation(token);
      checkRequest();
      return result;
    } catch (error) {
      checkRequest();
      if (error instanceof ClientError && error.status === 401) {
        await this.serial(async () => {
          checkRequest();
          if (this.credential?.sessionToken !== token)
            throw new ClientError("SESSION_CHANGED");
          if (error.code === "AUTH_SESSION_REFRESH_REQUIRED") {
            await this.rotate(generation);
            throw new ClientError("SESSION_CHANGED");
          }
          await this.clear();
        });
        throw new ClientError("AUTH_SESSION_EXPIRED");
      }
      throw error;
    }
  }
  /** @param task 인증 작업. 실패 후에도 다음 작업이 실행되도록 큐 내부의 rejection만 흡수한다. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
  /** @param value 비민감 상태. 구독 중인 화면만 갱신한다. */
  private publish(value: SessionState): void {
    this.state = value;
    this.listeners.forEach((listener) => listener());
  }
  /** @param generation 요청 시작 당시 계정 세대. logout 이후의 오래된 결과를 차단한다. */
  private check(generation: number): void {
    if (generation !== this.generation)
      throw new ClientError("SESSION_CHANGED");
  }
  /** @param session 서버 상태. 다른 사용자/설치 ID로 조용히 전환되는 응답을 거부한다. */
  private sameIdentity(session: NativeSession): void {
    if (
      session.userId !== this.credential?.session.userId ||
      session.deviceId !== this.deviceId
    )
      throw new ClientError("AUTH_SESSION_EXPIRED");
  }
  /** @param generation 계정 세대. 성공해도 화면 개방은 최신 revalidate 호출만 결정한다. */
  private async validate(generation: number): Promise<void> {
    this.check(generation);
    if (!this.credential) throw new ClientError("AUTH_SESSION_EXPIRED");
    try {
      const session = await this.client.session(this.credential.sessionToken);
      this.check(generation);
      this.sameIdentity(session);
      this.credential = { ...this.credential, session };
      if (Date.parse(session.refreshAt) <= Date.now())
        await this.rotate(generation);
      this.check(generation);
    } catch (error) {
      this.check(generation);
      if (
        error instanceof ClientError &&
        error.code === "AUTH_SESSION_REFRESH_REQUIRED"
      ) {
        await this.rotate(generation);
        return;
      }
      if (
        error instanceof ClientError &&
        (error.status === 401 || error.code === "AUTH_SESSION_EXPIRED")
      )
        await this.clear();
      throw error;
    }
  }
  /** @param generation 계정 세대. 갱신 자체는 foreground 검증 잠금을 해제하지 않는다. */
  private async rotate(generation: number): Promise<void> {
    try {
      const response = await this.client.refresh(this.credential!.sessionToken);
      this.sameIdentity(response.session);
      await this.save(response, generation, false);
    } catch (error) {
      if (
        error instanceof ClientError &&
        (error.code === "SESSION_CHANGED" || error.code === "STORAGE")
      )
        throw error;
      await this.clear();
      throw new ClientError("AUTH_SESSION_EXPIRED");
    }
  }
  /** @param input 새 자격 증명. @param generation 계정 세대. @param reveal 검증 중에는 ready 발행 금지. */
  private async save(
    input: NativeAuthResponse,
    generation: number,
    reveal = true,
  ): Promise<void> {
    const response = NativeAuthResponseSchema.parse(input);
    try {
      this.check(generation);
      if (response.session.deviceId !== this.deviceId)
        throw new ClientError("AUTH_SESSION_EXPIRED");
      await this.persistence.save(response);
      this.check(generation);
      this.credential = response;
      if (reveal)
        this.publish({ status: "ready", userId: response.session.userId });
    } catch (error) {
      await this.client.signOut(response.sessionToken).catch(() => undefined);
      if (error instanceof ClientError && error.code === "SESSION_CHANGED")
        throw error;
      await this.clear();
      this.publish({ status: "storage_error" });
      throw new ClientError("STORAGE");
    }
  }
  /** 실패한 서버 폐기는 메모리에 유지해 정리 재시도 때 다시 시도한다. 자동 네트워크 재전송은 없다. */
  private async revokePending(): Promise<void> {
    for (const token of this.pendingRevocations) {
      try {
        await this.client.signOut(token);
        this.pendingRevocations.delete(token);
      } catch {
        /* 로컬 정리와 원격 폐기는 별개. 다음 명시적 정리에서 재시도한다. */
      }
    }
  }
  /** 장부를 먼저 잠그고 영속 정리를 확인한다. 실패를 로그아웃 완료로 표시하지 않는다. */
  private async clear(): Promise<void> {
    this.credential = null;
    const cleared = await this.persistence.clear();
    if (cleared && !this.deviceId) {
      try {
        // 초기 읽기 실패에서 복구한 경우, 토큰 삭제 확인 뒤 설치 ID까지 준비해야 로그인할 수 있다.
        const empty = await this.persistence.load();
        if (empty.credential || empty.needsCleanup)
          throw new ClientError("STORAGE");
        this.deviceId = empty.deviceId;
      } catch {
        this.publish({ status: "storage_error" });
        return;
      }
    }
    this.publish({ status: cleared ? "signed_out" : "storage_error" });
  }
}
