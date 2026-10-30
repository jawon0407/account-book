import { NotificationConsentStateSchema, type NotificationConsentChangeInput, type NotificationConsentState } from "@account-book/contracts";
import { CoreError } from "../core/core-error.js";
import type { UserDatabase } from "../core/user-database.js";

/** @param error 내부 DB 오류. @param read 조회 여부. @returns 원문 없이 고정 공개 오류만 반환한다. */
function databaseError(error: unknown, read: boolean): CoreError {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (candidate?.code === "28000" && candidate.message === "COLLECTOR_SESSION_INVALID") return new CoreError("AUTH_SESSION_EXPIRED", 401);
  if (candidate?.code === "22023" && candidate.message === "COLLECTOR_INPUT_INVALID") return new CoreError("COLLECTOR_VALIDATION_FAILED", 400);
  if (candidate?.code === "P0001" && (candidate.message === "COLLECTOR_VERSION_CONFLICT"))
    return new CoreError(candidate.message, 409);
  return new CoreError("COLLECTOR_SERVICE_UNAVAILABLE", 503, read);
}

/** API 최소 권한 연결에서만 제한된 서버 동의 함수를 실행한다. 인증 테이블을 직접 읽지 않는다. */
export class NotificationConsentRepository {
  /** @param database 검증된 사용자 문맥을 transaction에 한정하는 실행기. */
  public constructor(private readonly database: Pick<UserDatabase, "run">) {}

  /** @param userId 서명 검증된 sub. @param sessionId 서명 검증된 sid. @returns 이 세션 기준의 현재 동의 상태. */
  public get(userId: string, sessionId: string): Promise<NotificationConsentState> {
    return this.execute(userId, "select * from app_private.notification_consent_status($1)", [sessionId], true);
  }

  /** @param userId 검증된 회원. @param sessionId 요청한 서버 세션. @param input 엄격한 공유 계약 입력. @returns commit 후 상태. */
  public change(userId: string, sessionId: string, input: NotificationConsentChangeInput): Promise<NotificationConsentState> {
    return this.execute(userId, "select * from app_private.notification_consent_change($1,$2,$3,$4)",
      [sessionId, input.expectedVersion, input.action, input.action === "accept" ? input.noticeVersion : null], false);
  }

  /** @param userId 검증된 회원. @param sql 내부 고정 SQL. @param parameters 바인딩 값. @param read 조회 여부; 변경 실패는 자동 재시도 금지. */
  private async execute(userId: string, sql: string, parameters: unknown[], read: boolean): Promise<NotificationConsentState> {
    try {
      return await this.database.run(userId, async client => {
        try {
          const result = await client.query(sql, parameters);
          if (result.rows.length !== 1) throw new Error("INVALID_COLLECTOR_RESULT");
          return NotificationConsentStateSchema.parse(result.rows[0]);
        } catch (error) { throw databaseError(error, read); }
      });
    } catch (error) {
      if (error instanceof CoreError && error.code !== "LEDGER_SERVICE_UNAVAILABLE") throw error;
      // connect/commit 단계도 도메인 오류로 통일한다. 실패한 PATCH를 자동 재전송하지 않는다.
      throw new CoreError("COLLECTOR_SERVICE_UNAVAILABLE", 503, read);
    }
  }
}
