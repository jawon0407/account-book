# 은행 연결 저장소 개발 흐름

상태: A2.1 저장/권한 코드를 구현했고, 독립 리뷰 보완 후 실제 DB 112개·전체 1,192개·브라우저 인증 10개를 통과했다. PR18 정상 병합과 main 사후 검사까지 완료했다. 실제 은행 연결 완료를 뜻하지 않는다. 최신 실행 증거는 [진행 기록](../status/2026-09-28-bank-storage.ko.md)을 따른다.

## 왜 세 테이블인가요?

`bank_connection_requests`는 잠깐 유효한 연결 신청서, `bank_connections`는 사용자에게 귀속된 연결 목록, `bank_connection_credentials`는 서버만 복원할 암호화 자료다. 신청서는5분, 은행이 돌려준 인가 코드는 최대60초만 사용할 수 있다. 연결의 수명과 짧은 인증 요청의 수명을 분리하면 재인증·연결 해제·모바일 공유를 덜 얽히게 구현할 수 있다.

후속 A2.2에서는 상태 처리 함수까지 로컬 구현했다. 은행 화면 이동 → 실제 Callback → 공급자 코드 교환 → 결과 화면은 A3/A4에서 연결한다. 잔액·거래 수집·별도 모바일 앱도 따로 남아 있다.

## 한 요청이 흘러가는 순서

```text
검증된 로그인 사용자
  → 연결 신청(사용자·세션 + state/proof의 해시)
  → 은행 Callback(인가 코드를 API에서 암호화)
  → 본인·세션·proof·만료 확인 후 한 번만 교환 권한 획득
  → 임시 코드를 DB에서 제거한 뒤 API가 은행에 교환 요청
  → 성공한 연결과 암호화된 자격정보 저장
```

위 흐름 전체가 현재 구현됐다고 읽으면 안 된다. A2.1은 보관함과 저장 규칙, A2.2는 안전하게 상태를 바꾸는 함수다. HTTP 연결은 후속이다.

## A2.2 함수는 어떤 일을 하나요?

1. `start_request(id, session, environment, stateDigest, proofDigest)`: 서버가 만든 요청 UUID, 검증한 로그인 세션, 서버 환경, 두 난수의 지문을 받는다. `app.user_id`는 인증된 principal에서 설정한다. 같은 세션의 예전 대기는 취소하지만 이미 은행 교환 중이면 새 시작을 거부한다.
2. `callback_context(stateDigest)`: 은행에서 돌아온 state 지문으로 아직 유효한 요청 ID·사용자 ID·환경만 찾는다. API가 인가 코드를 올바른 사용자/요청에 묶어 암호화하기 위한 내부 조회다. 브라우저에 그대로 반환하는 API가 아니다.
3. `receive_callback(stateDigest, encryptedCode, denied)`: 암호화된 코드 또는 동의 거절을 기록한다. 이미 받은 Callback은 덮어쓰지 않는다.
4. `claim_exchange(id, session, proofDigest)`: 시작한 사람과 세션·확인값이 같은지 확인한다. 단 한 요청에만 암호문을 반환하고 DB의 임시 코드는 삭제한다. 여기서 DB commit 성공을 확인한 후 API가 은행에 요청해야 한다.
5. `finish_exchange(...)`: 은행 응답을 검증한 API가 새 연결 ID·암호화 식별자/토큰·만료 시각을 넘긴다. 연결/토큰/성공 상태를 전부 저장하거나 전부 취소한다. 기존 연결에 덮어쓰지 않는다.
6. `end_request(id, session, proofDigest, action)`: 취소·실패·만료를 처리한다. 이미 종료한 결과는 바꾸지 않고, 교환 중 취소로 다른 흐름이 끼어들게 하지 않는다.

**원자적**이라는 말은 “중간 결과만 남지 않는다”는 뜻이다. 토큰 저장이 실패했는데 화면에 연결 성공으로 보일 연결 행만 남는 일을 막는다. **행 잠금**은 동시에 두 요청이 같은 코드를 가져가지 못하도록 한 번에 한 요청이 처리하게 한다. 시간을 잠금 뒤에 검사하므로 기다리는 사이에 만료된 코드도 거부한다.

`app_bank_flow`는 사람이 로그인하거나 API가 `SET ROLE`로 바꿀 수 없는 함수 전용 역할이다. API에는 함수 실행만 추가하며 직접 테이블 쓰기는 계속 거부한다. 사용자 문맥을 마음대로 설정할 수 있는 API 서버 자체의 침해까지 막는 장치는 아니다.

요청이 만료되었다는 결과를 받았을 때도 DB transaction은 commit해야 만료 처리와 코드 삭제가 남는다. DB 응답 유실로 claim commit 여부가 불명확하면 은행에 재전송하지 않는다. A2.3 제한/정리 DB 함수는 아래에 추가했지만 HTTP 연결·주기 실행·활성 세션 재검증이 남아 있어 아직 외부 은행 연결을 활성화하면 안 된다.

신규 migration은 `202610010003_bank_request_intake.sql`, `202610010004_bank_request_exchange.sql`, `202610010005_bank_request_end.sql` 순서다. 승인된 migration 주체가 실행하며 앱 시작 시 자동 실행하지 않는다. 이번 검증은 로컬 폐기용 PostgreSQL에만 적용했고 Supabase 프로젝트에는 적용하지 않았다.

## A2.3 요청 제한과 청소를 쉽게 이해하기

`bank_request_limits`는 은행 거래 테이블이 아니라 잠깐 사용하는 방문 기록표다. 사용자별 최근5분5회, Callback 주소 지문별 최근1분60회의 승인 시각만 저장한다. 고정된 시각에 횟수를0으로 돌리는 대신 현재 시각에서 뒤로 세어 구간 경계의 두 배 요청을 막는다. 같은 사용자라도 다른 세션으로 옮겨 제한을 새로 받을 수 없다.

- `consume_start_limit()`: 매개변수 없이 서버 인증 문맥의 사용자 UUID를 이용한다. 허용 여부와 다시 시도할 때까지의 초를 반환한다.
- `consume_callback_limit(digest)`: API가 주소를 HMAC-SHA256으로 처리한32바이트 지문을 받는다. 원문 IP나 브라우저 임의 입력은 넣지 않는다. 원문 주소를 저장하지 않아도 요청 폭주를 제한할 수 있지만 분산 공격 전체를 막지는 못한다.
- `consume_limit(scope,digest)`: 두 공개 함수가 공유하는 내부 로직이며 API가 직접 호출할 수 없다. 잠금으로 마지막 한 슬롯을 두 서버가 동시에 쓰지 못하게 한다.
- `cleanup_requests(batch=100)`: 종류별1~500개까지 만료 미완료 요청을 종료하고 코드 암호문을 지우며, 만료 quota 행을 제거한다. 잠긴 행은 건너뛰므로 정리가 정상 연결을 오래 붙잡지 않는다. 다음 실행에서 다시 검사한다.

후속 NestJS API는 제한 결과를 **먼저 별도 transaction으로 commit**하고 은행 요청을 처리한다. 그래야 은행 오류로 작업이 취소되어도 이미 사용한 횟수가 사라지지 않는다. 제한 DB가 실패하면 요청을 통과시키지 않는다. 초과는429와 Retry-After로 안내할 예정이며 아직 HTTP에 연결하지 않았다.

정리 역할 `app_bank_maintenance`는 cleanup 실행만 할 수 있고 직접 로그인/테이블 조회 권한은 없다. 실제 실행 계정과 주기 실행은 운영 설정 후속이다. cleanup은 이미 성공한 연결이나 토큰을 지우지 않으며, 멈춘 코드 교환을 자동 재시도하지 않는다. 정리가 늦어져도 연결/교환 함수가 사용 순간 만료를 검사한다.

추가 SQL은 `202610020001_bank_request_limits.sql`, `202610020002_bank_request_cleanup.sql` 순서다. [이번 결과](../status/2026-10-02-bank-limits-cleanup.ko.md)에 검증 범위와 남은 API/공식 테스트를 구분했다.

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
6. `bank-parity.test.ts`와 `bank-times.test.ts`: TypeScript 선언을 실제 PostgreSQL 열/제약/인덱스와 대조하고 잘못된 연결·토큰 시간을 거부하는지 검사.

## 안전하게 검증하는 방법

실제 DB 검증은 고정된 폐기용 PostgreSQL에서 수행한다. A2.1 당시에는 GitHub Actions를 사용했고 A2.2는 로컬 PostgreSQL17도 사용한다. 테스트 지원 함수 `openBankDatabase(environment)`는 테스트 주소·폐기 허용 표시·서버 계정을 확인하고 새 `account_book_bank_test`만 만든다. 같은 이름이 이미 있으면 중단한다. `connect()`는 경쟁 요청에 사용할 별도 DB 연결을 만들고, `close()`는 이번 호출이 만든 연결·DB만 정리한다. 운영 DB URL을 넣어 실행해서는 안 된다.

RED는 저장 기능이 아직 없어 테스트가 실패하는 상태다. GREEN은 구현 후 동일 실패 사례가 통과한 상태다. TypeScript 검사만 통과하거나 SQL 문자열이 존재하는 것을 실제 DB 검증으로 대신하지 않는다. 정리 작업이 늦어져도 사용 순간 만료를 검사해야 하는 부분은 A2.2/A2.3에서 추가한다.
