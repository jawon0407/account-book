# 은행 연결 저장소 개발 흐름

상태: A2.1 구현 중. 이 문서는 설계와 구현 책임을 설명하며 실제 DB 검증이 끝났다는 뜻이 아니다. 최신 실행 증거는 [진행 기록](../status/2026-09-28-bank-storage.ko.md)을 따른다.

## 왜 세 테이블인가요?

`bank_connection_requests`는 잠깐 유효한 연결 신청서, `bank_connections`는 사용자에게 귀속된 연결 목록, `bank_connection_credentials`는 서버만 복원할 암호화 자료다. 신청서는5분, 은행이 돌려준 인가 코드는 최대60초만 사용할 수 있다. 연결의 수명과 짧은 인증 요청의 수명을 분리하면 재인증·연결 해제·모바일 공유를 덜 얽히게 구현할 수 있다.

아직 저장 구조만 만드는 단계다. 은행 화면 이동 → Callback → 일회성 코드 교환 → 결과 화면은 A2.2/A3/A4에서 연결한다. 잔액·거래 수집·별도 모바일 앱도 따로 남아 있다.

## 한 요청이 흘러가는 순서

```text
검증된 로그인 사용자
  → 연결 신청(사용자·세션 + state/proof의 해시)
  → 은행 Callback(인가 코드를 API에서 암호화)
  → 본인·세션·proof·만료 확인 후 한 번만 교환 권한 획득
  → 임시 코드를 DB에서 제거한 뒤 API가 은행에 교환 요청
  → 성공한 연결과 암호화된 자격정보 저장
```

위 흐름 전체가 현재 구현됐다고 읽으면 안 된다. A2.1은 이 흐름에서 사용할 보관함과 잘못된 저장을 막는 규칙이다. 상태를 바꾸는 함수와 HTTP 호출은 후속이다.

## 해시와 암호화의 차이

state/proof는 원문을 다시 알 필요 없이 같은 값인지 확인하면 되므로 해시를 저장한다. 은행 토큰과 공급자 사용자 식별자는 나중에 은행에 요청할 때 다시 필요하므로 암호화한다. 암호화 키는 API 서버에만 두며 DB/BFF/브라우저에 넘기지 않는다.

A1의 `encryptBankToken(value, context, keys)`는 문자열·소유자/자원/환경/용도·키 목록을 받아 새 암호화 봉투를 만든다. `decryptBankToken(envelope, context, keys)`는 태그와 문맥이 맞아야 복원한다. `provider_subject`는 식별자용 문맥이어서 access_token 문맥으로 바꿔 해석할 수 없다. SQL은 봉투의 모양만 확인하고 실제 복호화는 하지 않는다.

## 권한은 두 번 확인합니다

SQL GRANT는 누가 테이블에 접근하는지, RLS는 그 안에서 누구의 행이 보이는지를 제한한다. app_api에 사용자의 UUID를 트랜잭션 안에서만 설정하면 본인 행만 보인다. 설정하지 않으면0행이다. BFF와 Supabase 공개 역할은 금융 schema 접근 자체가 거부된다.

행에 user_id를 넣었다고 자동으로 안전해지는 것은 아니다. API가 검증한 로그인 결과에서 사용자 ID를 가져와야 한다. API 서버 자체가 침해되어 임의 SQL을 실행하면 사용자 설정을 바꿀 수 있으므로 RLS를 서버 침해의 완전한 방어로 설명하지 않는다.

복합 외래키는 연결 ID뿐 아니라 사용자·공급자·환경을 한 세트로 대조한다. 다른 사용자 연결에 토큰을 붙이거나 fake 자료를 live 연결로 옮기는 실수를 DB에서 거부한다. 암호문의 AAD 검사도 별도로 결속을 확인한다.

## 코드 읽는 순서

1. `supabase/migrations/202609280001_bank_connection_storage.sql`: 실제 테이블·저장 제약.
2. `202609280002_bank_connection_access.sql`: 조회 권한·RLS. 앱 시작 시 실행하지 않는다.
3. `packages/database/src/schema/bank-*.ts`: TypeScript 쿼리가 사용할 선언. 파일만 import해도 DB가 바뀌는 것은 아니다.
4. `tests/database/bank-storage.test.ts`: 잘못된 해시·TTL·봉투·연결 참조가 저장되지 않는지 검사.
5. `tests/database/bank-access.test.ts`: 실제 역할로 본인 조회와 타인/금지 작업 거부를 검사.

## 안전하게 검증하는 방법

현재 실제 DB 검증은 GitHub Actions의 고정된 폐기용 PostgreSQL에서 수행한다. 테스트 지원 함수 `openBankDatabase(environment)`는 테스트 주소·폐기 허용 표시·서버 계정을 확인하고 새 `account_book_bank_test`만 만든다. 같은 이름이 이미 있으면 중단한다. 반환된 `close()`는 이번 호출이 만든 DB만 정리한다. 운영 DB URL을 넣어 실행해서는 안 된다.

RED는 저장 기능이 아직 없어 테스트가 실패하는 상태다. GREEN은 구현 후 동일 실패 사례가 통과한 상태다. TypeScript 검사만 통과하거나 SQL 문자열이 존재하는 것을 실제 DB 검증으로 대신하지 않는다. 정리 작업이 늦어져도 사용 순간 만료를 검사해야 하는 부분은 A2.2/A2.3에서 추가한다.
