import { createHmac } from "node:crypto";
import type { NativeRateOperation, NativeRateLimitPort, NativeRateScope } from "./native-types.js";

type Query = (text: string, values: unknown[]) => Promise<{ rows: unknown[] }>;
const globalBudgets: Record<NativeRateOperation, number> = { signIn: 120, session: 1200, refresh: 600, signOut: 600, ledgerRead: 1200, ledgerWrite: 600 };

/** @param operation 서버 작업. @param scope 서버 제한 단위. 허용 조합만 받아 SQL 매개변수를 결정한다. */
function budget(operation: NativeRateOperation, scope: NativeRateScope): { seconds: number; limit: number } {
  if (!Object.hasOwn(globalBudgets, operation)) throw new Error("NATIVE_RATE_INVALID");
  if (scope === "global") return { seconds: 60, limit: globalBudgets[operation] };
  if (operation === "signIn" && scope === "email") return { seconds: 600, limit: 6 };
  if (operation === "signIn" && scope === "device") return { seconds: 600, limit: 30 };
  if (operation !== "signIn" && scope === "identity") return { seconds: 60, limit: operation === "session" || operation === "ledgerRead" ? 60 : operation === "ledgerWrite" ? 30 : 10 };
  throw new Error("NATIVE_RATE_INVALID");
}

/** DB 고정 시간 창과 원자적 증가를 사용하므로 여러 서버 인스턴스가 같은 제한을 공유한다. */
export class NativeRateLimiter implements NativeRateLimitPort {
  private readonly key: Uint8Array;
  /** @param query BFF 최소 권한 SQL 실행기. @param key 32바이트 HMAC 키; 다른 용도와 문자열 도메인을 분리한다. */
  public constructor(private readonly query: Query, key: Uint8Array) {
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error("NATIVE_RATE_INVALID");
    this.key = Uint8Array.from(key);
  }

  /** @param operation 서버 작업. @param scope 제한 단위. @param value 비공개 구분값. @returns 한도 이내인지 여부. DB 오류는 호출자가 503으로 처리한다. */
  public async consume(operation: NativeRateOperation, scope: NativeRateScope, value: string): Promise<boolean> {
    const { seconds, limit } = budget(operation, scope);
    if (typeof value !== "string" || value.length === 0 || value.length > 1024) throw new Error("NATIVE_RATE_INVALID");
    const fingerprint = createHmac("sha256", this.key).update(`native-auth-rate-v1\0${operation}\0${scope}\0${value}`).digest();
    // 정리는 전역 제한 검사 때만 수행한다. 현재 창과 겹치지 않는 native 행만 최대 500개 삭제한다.
    const result = await this.query(`with expired as (
      select fingerprint, kind, window_started_at from app_private.auth_rate_limits
      where $4::boolean and kind='native_auth' and window_started_at < clock_timestamp() - interval '20 minutes'
      order by window_started_at limit 500
    ), cleanup as (
      delete from app_private.auth_rate_limits r using expired e
      where r.fingerprint=e.fingerprint and r.kind=e.kind and r.window_started_at=e.window_started_at
    )
    insert into app_private.auth_rate_limits(fingerprint,kind,window_started_at,window_seconds,count)
    values($1,'native_auth',to_timestamp(floor(extract(epoch from clock_timestamp())/$2::integer)*$2::integer),$2,1)
    on conflict(fingerprint,kind,window_started_at) do update
      set count=least(app_private.auth_rate_limits.count+1,$3::integer+1)
    returning count`, [fingerprint, seconds, limit, scope === "global"]);
    const row = result.rows[0] as { count?: unknown } | undefined;
    if (result.rows.length !== 1 || !row || typeof row.count !== "number" || !Number.isSafeInteger(row.count) || row.count < 1 || row.count > limit + 1) throw new Error("NATIVE_RATE_INVALID");
    return row.count <= limit;
  }
}
