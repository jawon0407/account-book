# 2026-09-29 회원·금융 스키마 구현·적용 기록

## 범위와 현재 상태

- 사용자 승인: profiles의 최초 가입 경로·deleted_at을 포함한 신규 8개 테이블 생성.
- 브랜치/기준: feature/bank-state-transitions / 10ec214. 기존 미커밋 인증 변경과 사용자 .gitignore는 보존.
- SQL 5개, Drizzle 선언, 실제 DB 테스트, 개발 적용 도구, 한국어 설명을 작성했다.
- 원격 적용: **개발 Supabase에 적용 완료**, 2026-09-29 16:00:58 KST. 5개 migration을 하나의 transaction으로 COMMIT했다. 기존 Auth 회원 1명을 보존하고 프로필·member 역할을 연결했다.
- 8개 신규 테이블 모두 ENABLE/FORCE RLS. 실제 API/BFF 로그인으로 읽기 전용 권한 검사 13개 통과. 운영 배포·은행 호출·메일 발송·새 실사용자 생성은 하지 않았다.

## 검증 기록

- 기존 기준 `pnpm test`: exit 0 (`output/core-schema-baseline.log`).
- Identity RED: 미생성 테이블로 34개 실패 → SQL 작성 후 34개 통과.
- Ledger RED: 미생성 금융 테이블 실패 → 실제 API 역할 포함 SQL 검사 67개 통과.
- 선언 parity RED: 8개 export 없음 → 열 이름/타입/NULL/기본값 존재·PK 열·제약/인덱스 이름·고유/부분 여부·RLS 비교 8개 통과. 전체 CHECK 식·기본값 값·FK 동작·인덱스 열 순서 비교는 미포함.
- `pnpm test:db`: 기존 인증·은행 포함 **193개 통과** (로컬 PostgreSQL 17.11, `output/core-db-all.log`).
- migration 도구의 명령·preflight·SQL 체크섬·최소 권한 guard **4개 통과**.
- `pnpm typecheck`, `pnpm lint`: exit 0.
- 최종 `pnpm test`: **1,203개 통과** (legacy 205, contracts 74, database 19, API 176, web 643, E2E preflight 86; `output/core-all-tests-final.log`). E2E preflight는 실제 브라우저 여정 검증과 다르다.
- `pnpm build`: 웹/API/패키지 빌드 exit 0 (`output/core-all-build.log`).
- 독립 보안·코드 리뷰 완료. 중요 항목 1개 수정 후 실제 DB 회귀 통과. 전체 제품 침투테스트나 운영 보안 감사 완료를 뜻하지 않는다.

## 로컬 검증 환경

기존 PC에 PostgreSQL 도구가 없어 [PostgreSQL 공식 Windows 안내](https://www.postgresql.org/download/windows/)가 연결한 [EDB 바이너리](https://www.enterprisedb.com/download-postgresql-binaries)를 HTTPS로 받았다. PostgreSQL 17.11 portable runtime을 별도 Temp 폴더에서 loopback 127.0.0.1:5432에만 실행했다. 시스템 서비스·방화벽·PC 전체 인증서 설정은 변경하지 않았다.

다운로드 ZIP SHA-256: `b9424ee7bc60b52450ff910a3630225df32e633f3cb29c1d126d9299d59aea28`. 실행 파일은 Authenticode 서명 없음으로 확인됐다. 이 해시는 수신 파일 재현용이며 게시자 서명을 대체하지 않는다. 출처 확인은 공식 페이지의 HTTPS 링크로 했다. 테스트에는 고정 합성 계정만 사용하고 실제 Supabase DB에 파괴적 테스트를 실행하지 않았다.

## 개발 DB preflight → dry-run → 적용

- 승인 프로젝트 tjtamaazsilaegvvovhg만 대상으로 검사.
- 관리자 postgres, client TLS 검증 성공 및 풀러→DB TLS 활성.
- auth.users 필수 열 확인, 기존 app_private 7개 보존.
- 적용 전 app_identity/app_ledger 없음, bootstrap trigger 없음 확인.
- BFF 로그인/BFF 권한/API 역할 3개 존재, 고권한 속성·관리자 역할 상속 없음.
- 첫 rollback 검증에서 관리형 postgres의 SET ROLE app_api 권한 부재(42501)를 확인했다. 전체 rollback 후 스키마 미생성을 확인했으며, 관리자에게 API 멤버십을 부여하지 않았다.
- 적용 전 검증을 최소 권한 메타데이터 검사로 바꿨다. 다시 `--check`에서 8개 테이블·RLS·기존 회원 보존 검증 후 정상 ROLLBACK했다.
- `--apply`: 원자적 COMMIT 성공. 5개 SQL 체크섬·시각·테이블 목록의 비밀값 없는 영수증을 기존 사용자 전용 로컬 설정 디렉터리에 남겼다.
- 적용 후 실제 app_api: TLS/실제 역할, 사용자 문맥 없는 7개 테이블 조회 0행, 본인 프로필/역할 각 1행 확인. 실제 app_bff_login: TLS/역할 및 프로필/계좌 SELECT 권한 거부 확인. 총 13개.
- COMMIT 후 새 관리자 연결의 `--inspect`: 두 신규 스키마·가입 트리거 존재, 기존 app_private 7개, 안전한 런타임 역할 및 양 구간 TLS를 재확인했다.
- 개인정보 행·이메일·비밀번호·전체 URI는 출력하지 않았다. 실제 금융 기록이나 시험 거래도 원격 DB에 넣지 않았다.

## 진단·보완

- 이체 header는 runtime UPDATE 권한이 없으므로 불필요한 SELECT FOR UPDATE가 정상 생성을 막았다. header 불변성·FK·commit 검사를 유지하고 읽기 검증으로 바꿔 API 실제 권한 테스트 통과.
- node-postgres의 JS 배열 인수는 PostgreSQL 배열 문자열로 변환된다. JSON 배열 거부 테스트는 JSON.stringify로 실제 JSON 배열을 전달하도록 수정했다.
- 독립 리뷰: BEFORE INSERT 감사 트리거가 ON CONFLICT DO NOTHING에도 이력을 남기는 결함을 발견했다. 기존 프로필·탈퇴 표시·관리자 역할·감사 이력 보존 재시도 테스트에서 RED 확인 후, 수정 보호 BEFORE UPDATE와 실제 변경 감사 AFTER INSERT/UPDATE/DELETE를 분리해 GREEN으로 고쳤다.
- 리뷰 추가 검증: PUBLIC 함수 실행권 회수, 이체 날짜/메모 불일치 거부, 반대 방향 동시 이체 테스트를 추가해 통과했다.
- 첫 전체 테스트는 웹 route-wiring 1개가 5초 제한을 넘었다. 빌드와 테스트가 동시에 실행 중이었다. 해당 테스트 단독 16개 및 빌드와 분리한 전체 1,203개 재실행은 통과했다. timeout 값을 늘리거나 실패를 숨기지 않았다. 자원 경합은 원인 후보이며 재발 시 별도 성능 진단한다.

## 이번 판단과 남은 검토 한계

- 신규 DB 경계를 우선 검증했다. repository/API/UI·서비스 멱등성·전체 탈퇴는 범위 밖이며 테이블 생성만으로 완료 처리하지 않는다.
- parity 테스트의 전체 표현식 비교 확대는 후속 소규모 보완이다. 핵심 권한·FK·금액·이체 규칙은 실제 SQL 동작으로 검증했지만 모든 선언 차이를 자동 탐지한다고 주장하지 않는다.
- 적용 도구는 기존 미커밋 인증 도구에 의존한다. 불완전한 부분 커밋이나 이전 작업의 임의 혼합을 피하고 이번 변경도 로컬에 보존했다. 커밋·푸시·PR·병합은 하지 않았다. 기존 인증 작업의 검토·커밋 경계를 먼저 정리해야 한다.

## 남은 작업

- [x] 독립 리뷰 결과의 중요 항목 해결
- [x] 전체 회귀 테스트·빌드 최종 통과
- [x] 개발 DB rollback dry-run
- [x] 신규 8개 테이블 실제 적용 및 계정 보존·runtime 재검증
- [x] Notion 02/12와 설계·계획에 실제 적용 및 API/UI 미완료 상태 반영, 재조회 확인
- [ ] 기존 미커밋 인증 변경과 의존성을 정리한 후 커밋 범위 확정 (이번에는 보류)

SQL/schema 완성은 금융 API·장부 화면·앱·탈퇴 전체 기능 완성이 아니다. 상세 사용법은 [회원·금융 테이블 가이드](../database/core-schema.ko.md)를 따른다.
