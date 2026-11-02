import { z } from "zod";
import {
  NativeAuthResponseSchema,
  NativeDeviceIdSchema,
  type NativeAuthResponse,
} from "@account-book/contracts";

export const SESSION_KEY = "account-book.session.v1";
export const DEVICE_KEY = "account-book.installation.v1";
const StoredSession = NativeAuthResponseSchema.extend({
  origin: z.string(),
}).strict();
export interface SessionStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** OS 저장소 형식/기기 결속만 관리한다. 서버 인증 여부나 UI 상태는 결정하지 않는다. */
export class SessionPersistence {
  /** @param storage OS 보안 저장소. @param origin 빌드의 고정 서버. @param createDeviceId 신규 설치 UUID 생성기. */
  public constructor(
    private readonly storage: SessionStorage,
    private readonly origin: string,
    private readonly createDeviceId: () => string,
  ) {}

  /** 저장된 값은 서버 검증 전의 후보일 뿐이다. 기기 키를 재생성한 경우에는 복원을 허용하지 않는다. */
  public async load(): Promise<{
    deviceId: string;
    credential: NativeAuthResponse | null;
    needsCleanup: boolean;
  }> {
    const existing = NativeDeviceIdSchema.safeParse(
      await this.storage.get(DEVICE_KEY),
    );
    const deviceId = existing.success
      ? existing.data
      : NativeDeviceIdSchema.parse(this.createDeviceId());
    if (!existing.success) await this.storage.set(DEVICE_KEY, deviceId);
    const raw = await this.storage.get(SESSION_KEY);
    if (raw === null)
      return { deviceId, credential: null, needsCleanup: false };
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      candidate = null;
    }
    const saved = StoredSession.safeParse(candidate);
    if (
      !existing.success ||
      !saved.success ||
      saved.data.origin !== this.origin ||
      saved.data.session.deviceId !== deviceId
    )
      return { deviceId, credential: null, needsCleanup: true };
    return {
      deviceId,
      credential: {
        sessionToken: saved.data.sessionToken,
        session: saved.data.session,
      },
      needsCleanup: false,
    };
  }

  /** @param response 검증된 불투명 앱 세션. 이메일/비밀번호·금융 기록은 저장하지 않는다. */
  public save(response: NativeAuthResponse): Promise<void> {
    return this.storage.set(
      SESSION_KEY,
      JSON.stringify({ origin: this.origin, ...response }),
    );
  }

  /** 먼저 복원 금지 표식을 덮어쓴다. 삭제 실패는 사용자에게 정리 미완료로 알려 재시도하게 한다. */
  public async clear(): Promise<boolean> {
    try {
      await this.storage.set(SESSION_KEY, JSON.stringify({ signedOut: true }));
    } catch {
      /* 표식 쓰기가 실패해도 실제 삭제가 성공하면 credential은 남지 않는다. */
    }
    try {
      await this.storage.remove(SESSION_KEY);
      return true;
    } catch {
      // 표식과 삭제가 모두 실패하면 영속 로그아웃을 보증할 수 없으므로 false다.
      return false;
    }
  }
}
