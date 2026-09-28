# 10-A2.1 저장 구조 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 주 구현자가 순차 실행하고 마지막에 새 독립 리뷰어를 사용한다. 사용자 요청에 따라 일반 작업의 반복 승인 대기는 생략한다.

**Goal:** 은행 연결 요청·연결·암호문 저장 구조와 본인 조회 권한을 실제 DB에서 검증한다.
**Architecture:** app_bank SQL migration을 원본으로 Drizzle 선언을 맞춘다. 런타임 쓰기는 닫고 후속 A2.2 상태 함수에서만 연다.
**Tech Stack:** PostgreSQL17, Drizzle0.45.2, pg8.22.0, Node22.15.1, Vitest4.1.11. 새 resolved 버전은 없다. 실DB 구조 대조를 위해 기존 Drizzle을 tests/database의 직접 개발 의존성으로 연결했다.
**Spec:** [상세 설계](../specs/2026-09-28-bank-storage-design.md).

## Global Constraints

- provider=kftc; environment=fake/test/live; channel=web; 요청300초·코드60초 최대.
- raw state/proof/인가 코드/토큰/공급자 식별자를 저장하지 않는다. A1 봉투와 provider_subject AAD를 사용한다.
- app_api는 본인 SELECT만, BFF·공개 역할은 접근 없음. 운영 migration·실계좌·비용 변경 없음.
- 사용자 .gitignore 미커밋 변경과 기존 이력/실패 증거 보존. feature 브랜치·정상 PR만 사용한다.
- SQL·함수 설명과 매개변수/반환/오류 의미는 한국어로 작성한다.

## Review Focus

1. JSON null/잘못된 최상위 타입의 SQL CHECK 삼값 논리 우회 → 형식 검증은 항상 boolean false 반환.
2. 전역 cluster role을 공유하는 기존 인증 테스트 → 직렬 실행, 새 bank DB만 생성·정리, 기존 DB 발견 시 중단.
3. RLS의 소유자 우회/상승 → FORCE RLS와 실제 SESSION AUTHORIZATION app_api 권한 검사.
4. 다른 사용자·환경의 연결 ID 참조 → 두 FK를 복합키 전체로 검사.
5. 무한/정확한 TTL/종료 상태에 남은 코드 → 상태표·유한 시각·코드 NULL 결속 사례 추가.

## 파일 지도·예상 규모

제품/테스트 약14~17파일·700~1100줄, 문서3파일 내외 예상. 실제 diff를 완료 기록에 남긴다.

- supabase/migrations/202609280001_bank_connection_storage.sql: 형식 함수·3테이블·제약.
- supabase/migrations/202609280002_bank_connection_access.sql: 권한·RLS·기본 권한.
- packages/database/src/schema/bank-{shared,connections,requests,credentials}.ts: 역할별 선언.
- packages/database/src/schema/bank.test.ts + src/index.ts: export/정합성 검사.
- apps/api/src/bank-connections/security/token-envelope.ts + test: provider_subject purpose.
- tests/database/support/bank-database.ts, bank-storage.test.ts, bank-access.test.ts: 안전한 fixture·데이터/권한 검증.
- tests/database/vitest.config.ts, tsconfig.json: 직렬 실행·support 포함.
- docs/database/bank-connections.ko.md, docs/status/2026-09-28-bank-storage.ko.md: 초급 개발자 설명/실행 증거.

## Task 1: 공급자 식별자 암호화 문맥

**Interface:** 기존 encryptBankToken/decryptBankToken의 context.purpose에 provider_subject 추가. 기존 용도 이름/봉투 형태 불변.

- [x] provider_subject roundtrip 성공 및 access_token으로 복호화 실패 테스트 작성.
- [x] API 집중 테스트 RED 확인 → allowlist/type만 확장 → GREEN.
- [x] 새 key/digest/공개 응답 필드는 추가하지 않고 변경을 기록.

## Task 2: 저장 제약과 역할 격리

**Interface:** app_bank의3테이블과 Drizzle bankConnections/bankConnectionRequests/bankConnectionCredentials export. API query 연결은 후속 작업.

- [x] 폐기용 fixture `openBankDatabase(): Promise<{admin:Client;close():Promise<void>}>`와 고정 role 전환 helper 작성. URL/flag/identity/기존 DB 검증 뒤에만 생성. close는 생성 소유권이 있을 때만 고정 DB 삭제.
- [x] 실제 DB 테스트에서 to_regclass 기대3테이블, 소유자 조회·거부/제약 사례 작성. RED 단계 migration 부재는 빈 migration 목록으로 처리해 ENOENT가 아니라 테이블 부재 assertion을 관찰.
- [x] 테스트 파일 직렬화와 support 타입 검사 적용. focused 타입/lint 통과 후 feature RED 커밋·push, GitHub DB 단계의 의도한 실패 확인. main/PR 병합 금지.
- [x] spec의3테이블·순수 envelope 형식 함수·최소 SELECT/RLS를 SQL로 구현.
- [x] 역할별 TS 파일로 동일 열·제약 선언. getTableConfig와 실제 pg_attribute/pg_constraint/pg_index를 비교하는 테스트 추가.
- [x] 로컬 pnpm verify, 새 feature push의 실제 DB GREEN·기존 인증/브라우저 CI 확인. 최종 후보2e2a068: 전체1,192·DB112·브라우저10개, run36443403382 성공.
- [x] 개발 가이드에 저장/암호화/권한의 역할 차이와 A2.2 미구현을 명시.

## Task 3: 통합 검토·전송·기록

- [x] 새 독립 리뷰어에게 전체 변경·spec·검증 증거 전달. Critical0/Important1/Minor0. 실DB 대조·시간 검사 누락을 한 차례 보완했고 새 DB112개 및 전체 회귀를 통과했다.
- [x] 실제 파일 수/줄 수, RED/GREEN/전체 검증/한계를 MD 및 Notion10/A2 페이지에 기록.
- [x] 최신 c13a5a7의 push36444134209·PR36444190431, 정상 PR18 merge b7ecd830, main36444621225 provenance/품질 실행 확인. 보호 우회 없음.
- [x] A2.1만 완료됐음을 기록하고 [A2.2 사전 범위](../../status/2026-09-29-bank-state-transitions-next.ko.md)를 다음 기능 브랜치에 정리했다. A2.2 상세 설계/실행 계획/구현은 다음 작업이며 이번 완료에 포함하지 않는다.

## 계획 자체 검토

spec 저장·권한·암호화 추가 문맥은 Task1/2에, 운영 범위 제외와 실제 CI 근거는 Task3에 대응한다. 상위 A2.2·A2.3은 이 계획 완료로 체크하지 않는다. 함수 인수/출력과 실제 테이블 이름을 통일했다. 공급자 식별자 지문만으로 복원할 수 없는 초안 문제는 암호화 봉투로 정정했다.
