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
  return drizzle({ connection: connectionString, schema });
}
