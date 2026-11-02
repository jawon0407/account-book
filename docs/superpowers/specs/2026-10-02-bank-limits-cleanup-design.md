# A2.3 테스트 은행 연결 — 공유 제한과 만료 정리

## 목적과 범위

조회 전용 은행 연결을 공식 테스트 API로 이어가기 전, 여러 NestJS 서버가 공유할 abuse 제한과 버려진 인증 자료 정리를 만든다. 사용자는 일반 개발의 반복 승인을 생략하고 MD·Notion 기록과 테스트를 계속하도록 지시했다. 기존 기능 worktree의 미커밋 인증·거래·A2.2 변경은 보존한다. 실계좌·운영 DB·비밀값·결제·외부 배포·Git 전송은 이번 범위가 아니다.

architectural 작업이며 문서→TDD→로컬 PostgreSQL→독립 리뷰를 유지한다. 이전에 선택한 순차 구현+마지막 리뷰 방식을 유지한다. 메일은 사용자가 10월2일 예약 완료했다고 알렸으며 발송/수신 성공을 직접 검증한 것은 아니다.

## 대안과 선택

1. **PostgreSQL 슬라이딩 윈도(선택):** 기존 DB에서 사용자별 최근300초5회, Callback 주소 지문별 최근60초60회를 정확히 공유한다. 저장 timestamp 배열은 최대5/60개라 한 key당 처리량이 제한된다. SQL/잠금 검증 부담은 있다.
2. 고정 구간 카운터: 짧지만 구간 경계에서 두 배 burst가 가능해 제외한다.
3. Redis: 높은 처리량에 유리하지만 추가 운영·비용을 지금 도입하지 않는다.

## 제한 저장·함수 계약

`app_bank.bank_request_limits`: scope(start/callback), key_digest(bytea32), accepted_at(timestamptz[],1..5/60), expires_at(마지막 승인+300/60초), 복합 PK(scope,key_digest), expires_at 인덱스. 원문 IP·이메일·계좌·토큰은 없다. 시작 key는 DB가 검증 principal GUC의 UUID를 SHA256으로 변환한다. Callback key는 후속 API가 신뢰 proxy 규칙으로 얻은 주소를 서버 비밀키 HMAC-SHA256으로 처리한 값이어야 한다. 브라우저가 보내는 지문이나 임의 X-Forwarded-For는 사용하지 않는다. HMAC 키 교체는 제한을 초기화할 수 있으므로 A3 운영 정책으로 관리한다.

- `consume_start_limit()` → table(allowed boolean,retry_after_seconds integer). 사용자 문맥 없으면 BANK_IDENTITY_REQUIRED. 다른 세션이어도 같은 사용자 quota다.
- `consume_callback_limit(p_digest bytea)` → 같은 결과. 정확히32바이트만 허용하고 문맥 없는 Callback도 처리한다.
- `consume_limit(p_scope text,p_digest bytea)` → 내부 함수. scope에 따라 고정 시간/횟수를 선택한다. app_api는 직접 실행할 수 없다.

같은 scope/key를 advisory transaction lock으로 직렬화한 뒤 행을 잠그고 clock_timestamp를 읽는다. 최근 구간 밖 승인 시각을 제거하고, 꽉 찼으면 false와 첫 승인 만료까지 ceil 초(최소1)를 반환한다. 거절은 새로운 timestamp를 저장하지 않아 잠금이 무한 연장되지 않는다. 허용은 timestamp1개를 추가하고 TTL을 갱신한다. 서버 오류 때 허용으로 우회하지 않는다.

이 함수는 A3 API에서 각 시작/Callback 처리 **전에 별도 짧은 transaction으로 호출·커밋**한다. 실패한 은행 요청 때문에 quota가 rollback되지 않아야 한다. HTTP429/Retry-After, 요청 크기/timeout/edge 제한은 A3에서 연결한다. 이번 DB 함수만으로 인터넷 abuse 방어가 활성화됐다고 주장하지 않는다.

## 정리 함수 계약

`cleanup_requests(p_batch integer default100)` → table(expired_requests integer,removed_limits integer). p_batch는1..500, NULL/0/초과는 BANK_CLEANUP_BATCH_INVALID. 각 대상 종류별 최대 p_batch라 한 번에 최대2*p_batch 행을 처리한다.

잠그지 않은 만료 미완료 요청을 FOR UPDATE SKIP LOCKED로 가져와 실제 잠금 후 시각을 재확인한다. awaiting_callback/awaiting_completion/exchanging 중 요청 expires_at 또는 코드 code_expires_at 만료이면 expired로 바꾸고 임시 암호문을 제거한다. 교환 중 서버가 끊긴 요청은 최대300초 요청 만료 때 닫으며 코드를 자동 재전송하지 않는다. 연결/자격정보와 terminal 요청은 변경·삭제하지 않는다. 종료 요청 장기 보존/삭제는 별도 정책이다.

만료 quota 행은 동일하게 SKIP LOCKED로 제한 삭제한다. 정리 지연/잠금으로 생략해도 consume/claim의 사용 시점 만료 검사가 유효하다. 만료 요청 조회 인덱스는 미완료 상태에 한정해 least(expires_at,code_expires_at) 표현을 사용한다.

## 권한

기존 app_bank_flow(NOLOGIN·NOINHERIT·NOBYPASSRLS, 테이블 owner 아님)가 네 함수를 소유한다. 고정 search_path=pg_catalog,pg_temp, 모든 테이블 schema 명시, PUBLIC EXECUTE 회수. 새 quota 테이블 ENABLE/FORCE RLS 및 flow 역할 전용 정책. app_api/BFF/공개 역할은 quota 직접 SELECT/DML 불가. app_api는 공개 limit 함수2개만 실행 가능.

새 app_bank_maintenance는 NOLOGIN·NOINHERIT·NOSUPERUSER·NOCREATEDB·NOCREATEROLE·NOBYPASSRLS이며 기존 unsafe 속성/membership이 있으면 migration 거부. 정리 함수만 실행 가능하고 테이블 직접 접근은 없다. 실제 worker LOGIN 역할·membership·스케줄 등록은 운영 단계에서 별도로 설정한다. 현재 자동 정리 스케줄은 설치하지 않는다.

## 검증

실제 폐기용 PostgreSQL17에서 한도초과·사용자/지문격리·슬라이딩만료·거부 미연장·NULL/길이·병렬 마지막1슬롯·잠금 뒤 시각 재검사, cleanup의 코드/요청만료·미만료보존·terminal/credential보존·batch·잠긴행생략·권한·Drizzle 카탈로그 일치. 병렬 시험은 첫 transaction을 연 채 두 번째가 Lock 상태임을 확인한 뒤 해제한다. 전체 일반/DB·lint·타입 회귀, PC 로그인 Playwright smoke, 독립 리뷰를 수행한다. 은행 UI/API 공식 테스트와 구분한다.

## 후속

A3 NestJS repository/provider adapter와 fake→KFTC test 전용 구성 → A4 BFF·PC 화면 → A5 통합 테스트 → A6 공식 테스트(Callback/포털 등록/서버 secret 별도). 조회 API·수집·알림은 그 다음이다. API 키·토큰은 채팅/Notion에 복사하지 않는다.

근거: [기존 A2 승인 설계](https://app.notion.com/p/3e9323168ba681e8a316c64f155f3a84), [PostgreSQL 잠금](https://www.postgresql.org/docs/17/sql-select.html), [함수 보안](https://www.postgresql.org/docs/17/sql-createfunction.html).
