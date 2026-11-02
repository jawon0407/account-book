import { z } from "zod";
import type { SessionStorage } from "../auth/session-persistence";

export const CONSENT_VERSION = "notification-access-v1";
const ScopeSchema = z.object({
  origin: z.url().startsWith("https://"),
  userId: z.uuid(),
  deviceId: z.uuid(),
});
export type ConsentScope = z.infer<typeof ScopeSchema>;
const RecordSchema = ScopeSchema.extend({
  version: z.literal(CONSENT_VERSION),
  state: z.literal("accepted"),
  acceptedAt: z.iso.datetime(),
}).strict();
export type ConsentRecord = z.infer<typeof RecordSchema>;
// 화면을 나갔다가 들어와도 같은 키의 저장/철회 순서를 유지한다.
const pending = new Map<string, Promise<unknown>>();

/** 계정·설치별 준비 동의. 서버 증빙이나 자동 수집 허가를 대신하지 않는다. */
export class NotificationConsentStore {
  private readonly scope: ConsentScope;
  private readonly key: string;
  /** @param storage OS 보안 저장소. @param scope 서버 확인을 마친 현재 신원과 고정 API origin. */
  public constructor(
    private readonly storage: SessionStorage,
    scope: ConsentScope,
  ) {
    this.scope = ScopeSchema.parse(scope);
    this.key = `account-book.notification-consent.${this.scope.userId}.${this.scope.deviceId}`;
  }
  /** 같은 키의 이전 변경이 끝난 뒤 유효한 현재 버전 동의만 읽는다. */
  public read(): Promise<ConsentRecord | null> {
    return this.serial(() => this.readRecord());
  }
  /** @param acceptedAt 명시적 선택 시각. 저장 후 읽기까지 일치해야 성공한다. */
  public accept(acceptedAt: string): Promise<ConsentRecord> {
    return this.serial(async () => {
      const value = RecordSchema.parse({
        ...this.scope,
        version: CONSENT_VERSION,
        state: "accepted",
        acceptedAt,
      });
      await this.storage.set(this.key, JSON.stringify(value));
      const saved = await this.readRecord();
      if (!saved || saved.acceptedAt !== acceptedAt)
        throw new Error("CONSENT_STORAGE_FAILED");
      return saved;
    });
  }
  /** 현재 계정·설치의 동의만 삭제한다. OS 권한과 서버 거래는 변경하지 않는다. */
  public withdraw(): Promise<void> {
    return this.serial(async () => {
      await this.storage.remove(this.key);
      if ((await this.storage.get(this.key)) !== null)
        throw new Error("CONSENT_STORAGE_FAILED");
    });
  }
  private async readRecord(): Promise<ConsentRecord | null> {
    const raw = await this.storage.get(this.key);
    if (raw === null || raw.length > 2048) return null;
    try {
      const record = RecordSchema.parse(JSON.parse(raw));
      return record.origin === this.scope.origin &&
        record.userId === this.scope.userId &&
        record.deviceId === this.scope.deviceId
        ? record
        : null;
    } catch {
      return null;
    }
  }
  /** @param action 같은 키의 한 작업. 실패해도 후속 철회/재조회는 실행한다. */
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = (pending.get(this.key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(action);
    pending.set(this.key, result);
    void result
      .finally(() => {
        if (pending.get(this.key) === result) pending.delete(this.key);
      })
      .catch(() => undefined);
    return result;
  }
}
