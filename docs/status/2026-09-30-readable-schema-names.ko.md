# 사용자·금융 테이블 이름 변경 결과

기준: 2026-09-30, `feature/bank-state-transitions` / `10ec214` 위 미커밋 변경. [작업 계획](../superpowers/plans/2026-09-30-readable-schema-names.md).

## 결과

2026-09-30 **02:25:39 KST** 승인된 개발 Supabase 프로젝트에 적용했다. 실제 UTC 영수증은 `2026-09-29T17:25:39.008Z`다. 데이터/보안 메타데이터의 변경 전후 동일성을 검사한 뒤 COMMIT했고, 새 연결로 최종 이름과 실제 API/BFF 역할의 접근을 다시 확인했다.

| 기존 | 현재 | 의미 |
| --- | --- | --- |
| app_identity.profiles | user.users | 닉네임·프로필 경로·가입 경로·탈퇴 표시 |
| app_identity.user_roles | user.roles | 회원의 서비스 역할 |
| app_identity.role_change_events | user.role_history | 역할 변경 감사 이력 |
| app_ledger.accounts | finance.accounts | 은행·현금·카드 장부 계정 |
| app_ledger.categories | finance.transaction_categories | 수입·지출 분류 |
| app_ledger.transactions | finance.transaction_history | 개별 거래내역 |
| app_ledger.transfers | finance.account_transfers | 계정 사이 자금 이동의 공통 기록 |
| app_ledger.idempotency_requests | finance.request_deduplication | 생성 요청 중복 처리 방지 및 첫 성공 응답 |

Table Editor를 새로고침하고 스키마 드롭다운에서 **user 또는 finance**를 고른다. `public`이 비어 있는 것은 정상이다. API Exposed schemas에 추가하지 않는다. SQL에서는 `select ... from "user".users`처럼 user를 쌍따옴표로 인용한다.

Supabase `auth.users`는 로그인 계정, `user.users`는 앱 프로필이다. `user.roles`의 행은 PostgreSQL 로그인 계정이 아니다. account_transfers는 실제 은행 송금 기능이 아니다. request_deduplication의 키는 거래 자체 ID와 구별된다.

## 구현 방식과 파일

- 신규 `supabase/migrations/202609300001_readable_schema_names.sql`: 스키마 2개·테이블 7개의 ALTER RENAME(accounts 이름 자체는 유지). 테이블 재생성·데이터 복사·삭제 없음.
- 기존 SQL 5개는 적용 이력과 체크섬을 보존했다. 함수 9개의 CREATE OR REPLACE로 SQL 본문 참조·TG_TABLE_NAME 분기를 갱신했다. 함수 OID/owner/실행 권한/search_path는 유지한다.
- `packages/database/src/schema/identity.ts`, `ledger-*.ts`: 물리 이름과 Drizzle 대응. TypeScript export·제약/인덱스 이름은 유지해 불필요한 공개 계약 변경을 피했다.
- `apps/api/src/{profiles,accounts,categories,core}` SQL 5개 파일: 조회·수정·활성 회원·중복 방지 쿼리의 대상 갱신. HTTP 경로와 JSON은 그대로다.
- `tests/database` 기존 테스트/fixture 갱신, `schema-rename.test.ts` 신규 4개: 기존 데이터·OID·ACL·RLS 보존, 직접 접근 제한, 재실행 거부, 대상 스키마 충돌 롤백.
- `scripts/local-auth/rename-core-schema.mjs`: 프로젝트/TLS/CA/SQL 체크섬 고정, 3초 lock timeout, inspect/check/apply 분리. 관리자·사용자 ID·금융 행·데이터 지문은 출력하지 않는다.
- 현재 가이드·설계·문서 지도와 [Notion 기능 12](https://app.notion.com/p/3e3323168ba68111aec0e2e72326126f)를 갱신하고 재조회했다. 9월 29일 날짜별 기록의 옛 이름은 당시 이력으로 유지한다.

## 검증 증거

| 검사 | 결과 |
| --- | --- |
| 변경 전 실제 PostgreSQL baseline | 205개 통과 |
| 이름 변경 RED | 신규 3개 실패. 기대한 새 테이블이 없음을 확인 |
| 최종 실제 PostgreSQL 전체 | **209개 통과**, 새 설치·업그레이드·권한·금융 정합성 포함 |
| 전체 `pnpm verify` | **1,380개 통과**, lint·typecheck·API/웹 build 통과 |
| 일반 테스트 구성 | legacy205 + contracts89 + database19 + API205 + web776 + E2E preflight86 |
| 개발 Supabase `--check` | 임시 rename 후 보존 검사, 전체 rollback 성공 |
| 개발 Supabase `--apply` | 데이터 지문·OID·테이블/열 ACL·RLS·스키마/함수 권한·Auth ID 보존 |
| 적용 후 `--inspect` | 새 이름 8개, 실제 런타임 계정 검사 **19개 통과** |
| 실제 로컬 Nest → 개발 DB | **18개 통과**: profile/accounts/categories 200·계약·no-store, 비인증/재사용401 |

일반 1,380개와 별도 DB 209개는 다른 실행 범위다. 첫 verify는 테스트의 불필요한 인용부호 escape 2개로 lint 실패했고 수정 후 전체 재실행이 통과했다. 기본 셸은 다른 Node/pnpm을 가리켜 최초 DB 명령이 엔진 검사에서 거부됐다. 전역 설치를 바꾸지 않고 기존 전용 Node22.15.1/pnpm11.9.0으로 수행했다.

독립 리뷰는 SQL·소비자·실제 적용 실행기를 읽고 중대한 문제 없음으로 판단했다. 보완 요청한 기존 이체 데이터 fixture와 대상 스키마 충돌 롤백 검사를 추가했고 통과했다. 운영 환경·비밀값·서비스 전환·전체 검증 결과는 리뷰어 대신 실행자가 위 증거로 검증했다. 무관한 기존 dirty 변경은 이번 리뷰 대상이 아니다.

실제 HTTP 검사는 조회만 수행했다. 금융/프로필 업무 쓰기는 0건이며 정상 인증 과정의 JWT 재사용 방지 기록 3건만 생성됐다. 실제 브라우저 회원가입·소셜 전체 여정·모바일·은행 API·운영 침투 테스트를 실행한 것은 아니다.

## 운영과 다음 단계

초기 생성 도구는 기존 5개 SQL 기준이므로 새로운 빈 개발 DB를 만들 때는 기반 생성 다음 rename을 적용한다. 이미 변경한 개발 DB에서는 `node scripts/local-auth/rename-core-schema.mjs --inspect`만 사용한다. 자동 재실행·DROP/재생성·기존 영수증 삭제는 하지 않는다. 도구는 Supabase CLI migration history를 자동 등록하지 않으므로 향후 통합 배포 전에 실제 DB/SQL/이력을 대조한다.

현재 개발 서버가 중단된 상태에서 적용했다. 최신 API 빌드로 읽기 검사를 수행했다. 운영 무중단 배포를 위한 구/신 이름 공존 view는 만들지 않았으므로 다른 환경에서는 **쓰기 중지 → migration → 새 API 배포/재시작 → 읽기 검증** 순서가 필요하다. 운영 DB 적용 권한은 이번 개발 DB 승인과 별개다.

다음 제품 작업은 PC `/app` 화면·ky/React Query 연결이다. 거래/이체 쓰기 API·은행 수집·모바일·운영 보안 검증은 계속 미완료다. 이번 요청에 없는 커밋·푸시·PR·배포는 하지 않았으며 기존 기능 브랜치와 작업 공간을 보존한다.
