# 10-A2.1 계좌 연결 저장 구조와 최소 조회 권한

## 목적·진행 권한

PC 웹과 별도 모바일 앱이 같은 사용자 계좌 연결을 공유할 수 있도록 서버 저장 기반을 만든다. 현재는 화면·은행 HTTP·실계좌를 연결하지 않는다. 2026-09-28 사용자 요청에 따라 일반 개발은 재승인 없이 진행하고 비용·계약·실계좌 동의·운영 secret만 별도 알린다. 상위 기준은 Notion의 승인된 10-A 설계와 A1 암호화 도구다.

이번 작업은 새 저장 구조를 만드는 architectural 범위다. 상세 설계 → 파일별 계획 → RED/GREEN → 독립 리뷰 → 정상 PR/CI 순서를 유지한다. 사용자 지시에 따라 반복적인 승인 대기만 생략한다.

## 대안과 결정

| 방식 | 장점 | 단점·선택 |
| --- | --- | --- |
| API WHERE 검사만 | 코드가 짧음 | 누락·동시 요청에 취약하여 제외 |
| PostgreSQL 제약·RLS·후속 원자 함수 | 기존 DB에서 다중 서버 규칙 공유 | SQL 테스트 부담을 수용하고 선택 |
| 별도 Redis/워크플로 | 분산 잠금 편의 | 새 서비스·운영 비용을 지금 추가하지 않음 |

A2.1은 저장·조회 격리, A2.2는 원자적 상태 전이, A2.3은 공유 요청 제한·만료 정리로 나눈다. 하나의 거대한 SQL/테스트 파일로 합치지 않는다.

## 테이블과 불변 조건

전용 `app_bank` schema를 사용한다. 원문 state/proof/인가 코드/토큰/공급자 사용자 식별자와 계좌번호는 저장하지 않는다. 사용자·세션 UUID는 인증 결과에서 제공하며 기존 BFF 세션 테이블에 FK로 결합하지 않는다. 미래 모바일 세션과 세션 삭제 뒤 연결 유지가 가능해야 하기 때문이다. 실제 세션 유효성은 후속 API가 검증한다.

1. `bank_connections`: id/user_id/provider/environment/status/created_at/updated_at/consent_expires_at. provider=kftc, environment=fake/test/live, status=active/revoked/reauth_required. `(id,user_id,provider,environment)`에 복합 UNIQUE. 생성/변경 시각은 유한하고 updated_at >= created_at, 동의 시각은 NULL 또는 유한한 값이다.
2. `bank_connection_requests`: id/user_id/session_id/provider/environment/channel=web, state_digest/proof_digest(bytea32, 각각 UNIQUE), status, created_at/expires_at/callback_received_at/code_expires_at, encrypted_code(jsonb), connection_id. 상태7종은 A1 공개 계약과 같다. expires_at은 생성 뒤 최대300초이며 모든 저장 시각은 유한하다. 같은 user/session의 awaiting_callback·awaiting_completion·exchanging은 하나만 허용한다.
3. `bank_connection_credentials`: connection_id PK, user_id/provider/environment, encrypted_provider_subject/encrypted_access_token, nullable encrypted_refresh_token, access_expires_at/refresh_expires_at/created_at/updated_at. 연결의 복합키를 FK로 참조해 다른 사용자·공급자·환경에 붙일 수 없다. 요청의 연결 ID도 같은 복합 FK를 사용한다. 삭제는 CASCADE가 아닌 기본 거부이며 후속 해제 흐름에서 명시적으로 정리한다.

요청의 awaiting_completion에서만 encrypted_code/code_expires_at이 존재한다. callback_received_at >= created_at, callback_received_at < expires_at, code_expires_at > callback_received_at, 코드 TTL <=60초 및 요청 만료 이하를 강제한다. awaiting_callback에는 Callback 시각이 없다. exchanging/connected는 Callback 시각이 있어야 한다. connected일 때만 connection_id가 존재한다. 종료 상태에는 임시 암호문이 없다. 실제 현재 시각과의 비교·전이는 A2.2에서 강제하며 CHECK만으로 시간 경과에 따라 행이 자동 만료된다고 설명하지 않는다.

공급자 식별자는 비가역 지문만 저장하면 후속 조회 요청에서 복원할 수 없다. 초안의 지문 전용 방향을 수정해 자격정보 테이블에 A1 봉투로 암호화해 저장하고 AAD purpose에 `provider_subject`를 추가한다. 전역 사용자 매칭·연결 자동 병합·새 해시 키는 도입하지 않는다. 공식 응답의 필드 매핑은 A3/A6에서 공급자 어댑터가 담당한다.

## 암호화 봉투·타입

SQL 형식 검사는 version(숫자1), kid([A-Za-z0-9._-] 1..128), nonce(정규 base64url12바이트), ciphertext(1..65536바이트), tag(16바이트)만 허용한다. 추가/누락/NULL 필드·비정규 인코딩을 거부한다. 순수 IMMUTABLE·고정 search_path 함수이며 PUBLIC 실행을 철회한다. DB는 형식만 검사하고 진짜 GCM 태그·AAD 검증은 A1 API 복호화가 담당한다. 따라서 잘 생긴 가짜 봉투를 SQL이 진짜 토큰으로 인증한다고 주장하지 않는다.

Drizzle은 테이블 이름·열/타입·NULL·기본값·PK/UNIQUE/FK·인덱스·CHECK 이름과 표현을 SQL에 맞춰 선언한다. 권한·RLS·함수 본문은 SQL migration이 원본이다. 새로운 암호화 봉투 TS 형식은 저장 계층의 구조형 타입으로만 선언하며 API 패키지를 DB가 import하지 않는다. BFF DB client의 schema/연결 풀은 변경하지 않는다.

## 접근 권한과 위협 경계

`app_api`는 기존 hardened 역할을 재사용한다. `app_bank` USAGE와 세 테이블 SELECT만 허용한다. 본인 user_id 행만 RLS로 보이고, 트랜잭션 로컬 `app.user_id`가 없거나 빈 값이면0행이다. 잘못된 UUID 설정은 오류로 닫힌다. 사용자 ID는 검증한 API principal에서만 설정하고 요청 본문을 그대로 쓰지 않는다. 쿼리 종료 시 SET LOCAL은 사라져야 한다.

모든 테이블에 ENABLE/FORCE RLS, 역할별 SELECT 정책을 적용한다. app_api는 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/DDL/함수 직접 실행·owner 역할 전환 권한이 없다. `PUBLIC`, `anon`, `authenticated`, `service_role`, `app_session_bff`는 schema/테이블 접근이 없다. migration owner의 해당 schema 기본 테이블 권한을 정리하고 새 함수는 생성 transaction 안에서 PUBLIC 실행을 개별 철회한다. 다른 schema의 전역 기본 함수 권한은 변경하지 않는다. 생성 직후부터 schema PUBLIC 접근을 철회해 migration 파일 사이에도 노출 창을 만들지 않는다.

RLS는 API 자체 침해로 임의의 사용자 GUC를 설정하는 공격까지 방어하지 않는다. DB superuser/BYPASSRLS는 별도 관리 경계이고 런타임 URL에 금지한다. A2.2 최소 SECURITY DEFINER 상태 함수는 별도 설계/테스트 후 추가하며 이번에 쓰기 권한을 미리 주지 않는다.

## 검증과 완료 기준

현재 PC에는 PostgreSQL/Docker가 없다. 무료 GitHub Actions의 기존 PostgreSQL17에서 실제 DB RED/GREEN을 실행한다. 테스트는 정확한 로컬 폐기용 URL+flag를 요구하고 서버 current_user/database를 확인한다. `account_book_bank_test`가 이미 있으면 중단하며 새로 생성한 DB만 종료 뒤 삭제한다. 운영 DB/기존 DB 삭제·FORCE 삭제는 금지한다. 기존 인증 테스트와 role 충돌을 피하려고 파일을 직렬화한다. 먼저 실행한 파일이 남긴 cluster 역할은 재사용하고 은행 DB를 먼저 정리한 뒤 다음 파일로 넘어간다.

필수 검증: migration 순차 적용, 모든 열/제약, 사용자 A/B/빈 문맥/잘못된 문맥, 트랜잭션 뒤 문맥 소멸, BFF·공개 역할 거부, 런타임 DML/DDL/권한 상승 거부, 복합 FK 오결속, 해시 길이/중복, TTL 경계/무한 시각, 모든 상태와 임시 코드 정합성, 잘못된 봉투/추가 필드/NULL, API AAD purpose 간 복호화 거부. 기존 인증 DB·브라우저 회귀도 다시 실행한다.

실제 DB 테스트 통과 전에는 SQL 정규식/타입 검사를 DB 검증으로 표시하지 않는다. 실패한 RED 커밋은 feature에만 전송하고 main 병합하지 않는다. 완료는 독립 리뷰와 최신 PR/main CI까지이며 A2 전체·은행 연결·출시 완료와 구분한다.

## 근거

- [승인된 10-A 설계](https://app.notion.com/p/3e4323168ba6816491acc6a55dd9f1f2)
- [PostgreSQL17 RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [PostgreSQL17 함수 권한·search_path](https://www.postgresql.org/docs/17/sql-createfunction.html)
- [Drizzle 제약 선언](https://orm.drizzle.team/docs/indexes-constraints)
