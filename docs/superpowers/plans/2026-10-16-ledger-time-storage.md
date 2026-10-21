# 거래 시각 저장 실행 계획

Spec: `docs/superpowers/specs/2026-10-16-ledger-time-storage-design.md`

## 제약과 작업 원장

기존 linked worktree `feature/bank-state-transitions`에서 inline 실행. 이전 미커밋 변경 보존. Bash helper 실행 환경이 없어 이 파일의 체크/실행 기록을 ledger로 사용한다. commit/push/운영 이관은 이 계획에 없다. 공용 시간 계약만으로 저장/API 전체를 완료 처리하지 않는다.

Pre-flight: 공용 계약의 날짜-only/null 허용과 DB CHECK 일치, 기존 API DATE INSERT의 기본값, 이전 이관 시험의 baseline 순서를 함께 검사한다.

## Task 1 — 실패 시험

- [x] 공식 CLI help/version 확인 후 빈 migration 생성.
- [x] 기존 core fixture에 새 migration 선택 적용 옵션 추가. 과거 이관 시험에서는 후속 이관도 건너뛴다.
- [x] 거래 시각/이관 보존/이력 RLS·권한·동시성 시험 추가, 새 구조 없음 RED 확인.

Files: `supabase/migrations/*_ledger_time_storage.sql`, `tests/database/support/core-database.ts`, 새 `ledger-time-storage.test.ts`, `ledger-time-upgrade.test.ts`, `ledger-time-history.test.ts`.

Expected: 새 열/테이블 부재로 실패하며 기존 baseline 데이터 손상은 없음.

## Task 2 — 저장 구조 구현

- [x] 추가형 SQL, invoker 검증/이력 잠금, RLS·column GRANT 구현.
- [x] 역할별 파일 분리: 새 `packages/database/src/schema/ledger-time.ts`, `ledger-time-history.ts`; 기존 `ledger-transactions.ts`와 `index.ts` 연결.
- [x] 새 시험 GREEN, 전체 DB 회귀 통과. 리뷰 수정 후 다시 검사한다.

Expected: legacy 날짜는 변화 없음, 신규 snapshot 무결성, 타인/문맥 없음/탈퇴 접근 차단, 충돌 rollback 후 순번 정상.

## Task 3 — 검증·리뷰·기록

- [x] pnpm verify와 PC core Playwright, diff check.
- [x] fresh-context 범위 리뷰, Important/Critical 1회 수정 pass RED→GREEN.
- [x] 상태 MD·통합 설계·Notion 진행 기록 후 다시 읽기 확인.

Review Focus: nullable CHECK 우회, timezone 재계산으로 과거 변경 가능성, trigger privilege/owner, timestamp 정밀도, 동시 history INSERT와 rollback, 기존 DATE/계좌 미지정 migration 호환. UI/API 및 실제 Android 성공으로 과장하지 않기.

## 실행 기록

- 공식 CLI 2.121.0의 help/new help 확인. Supabase changelog.md 웹 도구는 content-type 오류로 직접 수신 불가; 다른 공식 문서와 MCP 열 권한 검색을 확인했다. 기존 전체 autoplan 참조/qa-only 템플릿 누락 제한 유지.
- Task 1 complete: 새 구조 부재 12실패/26통과 RED → SQL 구현 후 38개 GREEN. 로그 `output/ledger-time-storage-red.log`, `output/ledger-time-storage-green.log`. 거부 시험 단독 통과는 구조 완료 증거로 쓰지 않으며 정상 저장/이관 성공을 함께 검사했다.
- Task 2 Ruling: 기존 identity 전체 FORCE RLS 회귀를 새 네 번째 테이블까지 확장하니 미적용을 검출했다. FORCE RLS를 추가하고 이전 테이블 목록 기대값을 네 개로 갱신한다. 운영 owner BYPASSRLS 역할은 기존 전제이며 runtime은 아님.
- changelog는 PowerShell 읽기 전용 요청으로 재확인했다. PostgreSQL 15.19/17.11 breaking-change 공지를 추가 확인 대상으로 잡았다. 신규 SDK/관리 API 변경은 이 SQL 작업과 무관하다.
- PostgreSQL 공지의 ltree/legacy PGP cipher/float GiST/custom estimator 변경은 이번 이관에서 사용하는 기능이 아니다. 운영 프로젝트 전체 영향 감사로 확대하지 않는다.
- Task 2 complete: stale dist로 parity 1개 실패 → 패키지 rebuild. 새 이력 parity에서 FK 기본 명칭 불일치 RED → ORM FK 이름 명시. 전체 DB 394개/35파일/60.58초 통과. 첫 verify도 종료0(기존 2,051개), 최종 검증은 리뷰 보완 뒤 다시 수행.
- Final review: 독립 읽기 전용 범위 리뷰 Critical0/Important1/Minor0. 최초 baseline은 effective_from=null이라 시계 역행 검사를 건너뛴다. 미래 baseline 합성 fixture에서 잘못 INSERT되는 RED 확인 → 모든 이력의 created_at을 비교하도록 수정. 1차 수정 pass이며 전체 혼합 PR 리뷰로 표시하지 않는다.
- Final Ruling: API 이력 선택·profile version·멱등·cursor는 이 저장 단위에서 제공하지 않는다. 후속 API 연결 전 필수 검증이며 생략 시 잘못된 날짜/중복/충돌 위험이 있다.
- Final Ruling: Android/JS/PostgreSQL 시간대 자료·alias 동등성은 후속 통합/실기기 gate다. 다를 때 조용한 저장/재계산을 허용하지 않는다.
- Final Ruling: 256개는 공용 함수 호출의 자원 상한이지 이력 수명 제한이 아니다. API는 관련 전후 구간만 가져오도록 설계하며 무조건 첫256개를 쓰지 않는다.
- Final Ruling: 이체 쌍은 기존 DATE API를 유지한다. 시각 있는 이체 API를 노출하기 전에 두 원장 행의 일관성 계약을 별도로 닫는다. 이 단위를 시각 이체 구현으로 표시하지 않는다.
- Final Ruling: hosted 이관·운영 성능·UI/Android 및 기존 무관한 미커밋 변경은 이번 리뷰 보증 밖이다. 실금융 베타/배포 gate와 후속 검증 목록에 남긴다.
- Final fix verification: 전체 DB396개/35파일/84.21초, 최종 verify2,051개·린트·타입·API/웹 build·Android JS번들, PC Playwright18개/46.9초 모두 종료0. 독립 리뷰의 clock rollback 재현은 수정 후 GREEN. diff check 종료0.
- 공식 CLI 보안 advisor는 고정 loopback 폐기용 fixture에서 지적0/종료0. 최초 TLS 미지원 실패는 해당 loopback URI에만 sslmode=disable를 명시해 해결했다. 운영 TLS 설정은 유지했고 hosted DB를 조회/변경하지 않았다.
- Task 3 complete: Notion 최상위·04 기술 구조·07 진행 상태의 비동기 저장 성공 및 재조회 내용 일치를 확인했다. 제품/시험/문서15파일 단위의 결과를 기록했으며 전체 Android 완료/실기기/운영 배포로 표시하지 않는다. 다음 API·PC 표시·Android 입력 단위를 이어간다.
