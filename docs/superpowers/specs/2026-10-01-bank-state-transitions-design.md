# A2.2 은행 연결 요청의 원자적 상태 처리

## 목적과 범위

사용자가 승인한 우선순위는 수동 시작 잔액/이체 화면보다 금융결제원 테스트 연결이다. 최종 목표는 사용자 동의 계좌의 잔액·입출금 조회이며 송금 API는 제외한다. 기존 Notion 10-A/A2 설계를 이어서 저장소 상태 처리를 먼저 구현한다. 반복 승인 대기는 생략하되 설계·계획·RED/GREEN·독립 리뷰는 유지한다.

이번 산출물은 DB 함수와 실제 PostgreSQL 검증이다. HTTP·웹 은행 버튼·공식 KFTC 호출·실계좌·배포는 아직 산출물이 아니다. 다음은 A2.3 공유 제한/정리 → A3 API → A4 웹 → A5 통합 → A6 공식 테스트다. 공식 테스트에는 서비스 키 연결, 테스트 데이터, 허용된 Callback 등록이 필요하다.

## 대안

- API SQL만 사용: 작성이 쉽지만 런타임 직접 쓰기 권한과 조건 누락 위험이 커 제외.
- 작은 SECURITY DEFINER 함수: 기존 DB에서 잠금과 권한 규칙을 공유하므로 선택. SQL 검증·migration 부담은 수용한다.
- 별도 Redis/작업 엔진: 이번 규모에서 새 운영 의존성이 불필요하여 제외.

## 권한·시간·동시성

`app_bank_flow`는 NOLOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE 역할이다. 테이블 소유자가 아니며 다른 역할에 membership을 주지 않는다. 이 역할에만 세 은행 테이블 SELECT/INSERT/UPDATE와 전용 RLS 정책을 부여한다. API는 직접 DML 대신 지정 함수 EXECUTE만 갖는다. BFF·PUBLIC·Supabase 공개 역할 접근은 계속 금지한다. 모든 함수는 pg_catalog,pg_temp 고정 검색 경로와 명시적 schema를 사용한다.

인증된 함수는 `app.user_id`를 검증된 API principal에서 SET LOCAL로 받고 session UUID와 proof 지문을 매개변수로 비교한다. GUC는 API 침해까지 방어하지 않으며 실제 세션 활성 검사는 후속 API가 책임진다. Callback만 사용자 문맥 없이 state 지문으로 좁게 접근한다.

start는 user/session 조합 advisory transaction lock 후 기존 pending 행을 FOR UPDATE 한다. 다른 함수는 대상 행 FOR UPDATE만 사용해 역방향 잠금을 만들지 않는다. 잠금 획득 뒤 clock_timestamp()로 기한을 검사한다. 외부 HTTP 호출은 claim을 커밋한 뒤 DB 잠금 밖에서 수행해야 한다. claim 커밋을 확인하지 못하면 은행 호출을 하지 않는다.

## 함수 계약 (app_bank schema)

| 함수 | 입력 | 반환·행동 |
| --- | --- | --- |
| start_request | request_id uuid, session_id uuid, environment text, state/proof bytea32 | uuid 또는 NULL(교환 중). 기존 유효 대기는 취소, 만료 대기는 만료, 300초 새 요청 생성 |
| callback_context | state bytea32 | 유효 awaiting_callback의 id/user_id/environment만 0~1행. API가 인가 코드 AAD를 구성할 때만 사용, 토큰·proof 반환 금지 |
| receive_callback | state bytea32, encrypted_code jsonb, denied boolean | 수락 시 request UUID, 없거나 중복/만료면 NULL. 성공은 최대60초·요청기한 이하, denied는 failed. 중복이 기존 암호문을 덮어쓰지 않음 |
| claim_exchange | request_id/session_id uuid, proof bytea32 | 1회만 암호화 code jsonb, 그 외 NULL. 사용자/세션/proof 확인 후 만료를 기록하거나 exchanging 전이와 코드 삭제 |
| finish_exchange | request/session/connection uuid, proof bytea32, subject/access/refresh jsonb, access/refresh/consent 만료 timestamptz | boolean. exchanging이고 요청 기한 전일 때 연결+자격정보+connected를 한 transaction으로 저장. 기존 연결 덮어쓰기 금지 |
| end_request | request/session uuid, proof bytea32, action text(cancel/fail/expire) | 상태 text 또는 NULL. cancel은 exchanging을 취소하지 않음, fail은 exchanging만, expire는 요청/보관 코드 기한 도달 시만. 종료 상태 불변 |

finish의 refresh/consent는 NULL 허용, subject/access는 유효 봉투 필수. 새 자격정보 만료는 저장 시각 이후여야 한다. 만료와 정상 상태 거절은 예외로 rollback하지 않고 반환하여 코드 삭제가 커밋될 수 있게 한다. 형식/제약 위반은 전체 호출을 rollback한다. 모든 인증 함수는 잘못된 사용자·세션·proof로 상태를 바꾸지 않는다. 종료 시 임시 code/code_expires_at은 NULL이다. 교환 결과 불명확 시 같은 인가 코드를 반환·재교환하지 않는다.

## 검증·파일 지도

SQL3개: 권한/시작/콜백, 교환, 종료로 분리. 테스트는 시작·콜백, 교환, 동시성·권한으로 분리하고 fixture/helper만 공유한다. 기존 고정 폐기용 bank DB를 재사용하되 기존 DB 발견 시 중단하고 이번 호출이 만든 DB만 정리한다. 기존 테스트의 역할/테이블 검증을 약화하지 않는다.

정상 흐름, NULL/길이 오류, 만료, state 재사용, 소유자·세션·proof 불일치, rollback, 동시 start/Callback/claim, 취소·교환 경쟁, 잠금 대기 중 만료, 함수 ACL·owner·RLS·역할 상승 거부를 검사한다. 기존 전체 테스트와 DB 회귀를 별도로 실행한다. 이번에는 웹 변경이 없으며 PC 브라우저는 기존 로컬 페이지 smoke만 확인한다. 은행 웹 E2E 성공으로 표현하지 않는다.

## 문의 문안 (사용자 직접 발송, 미발송)

제목: 비사업자 개인 개발자의 조회 전용 오픈뱅킹 개발·실계좌 이용 조건 문의

안녕하세요. 사업자등록이 없는 개인 개발자이며, 사용자가 본인 명의 계좌를 연결하고 잔액·입출금 거래내역을 조회하여 카테고리와 메모로 정리하는 PC 웹/모바일 가계부 앱을 개발 중입니다. 송금·입금이체·출금이체 실행 기능은 제공하지 않습니다.

현재 개발자사이트 가입과 테스트 API 키 발급을 완료했습니다. 우선 테스트 데이터로 개발하고, 가능하다면 본인 실제 계좌로 검증한 후 향후 지인 및 일반 사용자에게 제공하려 합니다.

1. 사업자등록 없는 개인 개발자가 본인 실제 계좌의 잔액·거래내역을 조회·검증할 수 있는 별도 시험 절차가 있나요?
2. 없다면 조회 전용 서비스의 운영 API 이용에 필요한 사업자 형태, 이용신청·계약·보안 심사·비용은 무엇인가요?
3. 본인 계좌 시험과 다른 사용자의 동의 계좌를 연결하는 서비스 제공에 각각 어떤 조건이 적용되나요?
4. 향후 주기적 거래내역 조회·신규 내역 알림을 제공할 경우 허용 조회 주기·한도·데이터 보관 조건은 무엇인가요?

공식 문의처: https://openapi.kftc.or.kr/service/openBanking (openbanking_tech@kftc.or.kr). 키·계좌번호·신분증은 문의문에 첨부하지 않는다. 테스트 안내: https://developers.kftc.or.kr/dev/starter/starter .
