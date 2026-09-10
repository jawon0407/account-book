import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/auth.js";

/**
 * 전달받은 PostgreSQL 연결 문자열로 인증 테이블 스키마가 연결된 Drizzle 클라이언트를 만든다.
 * 이 함수의 검사는 공백뿐인 문자열 거부에 한정된다. 계정·SSL 검사는 호출 측 환경 설정의 책임이다.
 * @param connectionString - 이 클라이언트가 사용할 비밀 DB 연결 문자열. 로그로 남기지 않는다.
 * @returns 매 호출마다 만드는 새 Drizzle node-postgres 클라이언트.
 * @throws 빈 문자열 또는 공백뿐인 문자열이면 오류. 드라이버 생성 오류도 호출자에게 전달된다.
 */
export function createDatabaseClient(connectionString: string) {
  if (!connectionString.trim()) throw new Error("connectionString must not be blank");
  const database = drizzle({ connection: connectionString, schema });
  let reportedIdleError = false;
  // 유휴 연결 오류를 풀별 최초 한 번의 고정 진단으로 바꾼다. 오류와 client 인수는 비밀 노출을 막기 위해 사용하지 않는다.
  database.$client.on("error", () => {
    if (reportedIdleError) return;
    reportedIdleError = true;
    try {
      console.error("DB_POOL_IDLE_ERROR source=bff");
    } catch {
      // 진단 출력 실패가 DB 이벤트를 다시 처리되지 않은 예외로 만들지 않게 한다.
    }
  });
  return database;
}
