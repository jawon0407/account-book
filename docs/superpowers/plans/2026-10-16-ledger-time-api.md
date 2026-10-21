# SDD ledger — plan: docs/superpowers/plans/2026-10-16-ledger-time-api.md

Spec: `docs/superpowers/specs/2026-10-16-ledger-time-api-design.md`

기존 linked worktree `feature/bank-state-transitions`, BASE `8af7a0d`. inline 실행. Bash helper 부재에 따라 이 계획의 체크/실행 원장을 사용한다. 기존 혼합 변경은 commit/stage하지 않는다.

Pre-flight: DB time shape는 새 계약과 같고 날짜-only 기본값은 legacy_date다. 신규 API는 user 근거를 명시한다. 기존 멱등 JSON·수동 TS fixture의 호환을 위해 응답 time/ledgerTimeZone은 optional, 실제 repository는 명시적으로 반환한다. PC 기존 date 제출이 시각을 지우지 않도록 유지/정정 경계를 시험한다.

## Task 1 — 공용 계약

- [x] time 입력/저장 snapshot·profile 선택 계약 시험 RED.
- [x] 역할별 파일 `transaction-time.ts` 추가, 기존 profiles/transactions/errors/index 연결 및 GREEN.

Expected: 서버 결정 필드 위조 거부, legacy 응답 허용, 과거 snapshot 날짜 재계산 금지, 빈 수정 거부.

## Task 2 — 실제 API/DB

- [x] 실제 최소 권한 DB profile/time CRUD·멱등·경계·cursor 시험 RED.
- [x] profile CAS 이력, 새 transaction-time helper, repository/mapping/changes/cursor 연결.
- [x] CLI 생성 partial index 이관·Drizzle parity/fixture 연결. DB GREEN, HTTP 경계 검사.

Expected: 본인 이력만 사용, 이전 snapshot 유지, 안전한 null 페이지 정렬, 256 이후 이력도 지원.

## Task 3 — PC 호환

- [x] 시각 표기/명시적 시간 해제 시험 RED→GREEN. 관련 Next 로컬 문서 읽기.
- [x] 기존 core Playwright에 실제 native 생성 timed row→PC 표시/수정 경로 추가.

Expected: PC는 신규 생성하지 않음, 저장한 시간대 표시, 날짜만 아는 거래는 자정으로 표시하지 않음.

## Task 4 — 검증·리뷰·기록

- [x] 전체 DB, verify, PC Playwright, diff check.
- [x] 실행 스킬이 요구하는 독립 reviewer 1회. Critical/Important는 재현 RED→GREEN 한 pass, 나머지 판단 원장 기록.
- [x] 상태 MD/통합 설계/Notion 갱신 후 readback.

Review Focus: nullable SQL cursor 분기, idempotency 기존 hash/과거 response, profile version과 history 원자성, history 자원 상한, 시각 근거 위조, source/ledger zone 혼동, 저장 날짜 재계산, PC 정정 동의, 혼합 worktree 변경 범위. 전체 Android/PR/운영 성공으로 과장하지 않기.

## 실행 원장

- 범위 약20~25파일 예상(계약/API/DB/UI/시험/문서), 파일 역할 분리. hosted DB 변경 없음. Android 입력/알림 실제 기기 시험은 후속이다.
- 계약 RED 5실패/5통과 → 신규 10개 통과. 전체 공용 계약의 필드 allowlist에 time 누락 1건이 있어 보완했으며 전체 재실행을 기다린다.
- 최소 권한 DB 구현 전 profile/transaction 시험 실패를 확인했다. 구현 후 26개/3파일 통과(4.94초), 로그 output/ledger-time-api-db-green.log. 전체 DB 검증은 별도다.
- Task 2: Ruling: 기존 시간대 검증의 전체 pg_timezone_names 조회가 로컬에서 약214ms/회로 측정되고 300개 이력 시험이 시간 초과했다. 숫자 없는 IANA 이름은 PostgreSQL timezone 함수로 확인하고 숫자 포함 이름은 정확한 목록 조회를 유지한다. Asia/Seoul+09 POSIX 해석 허용을 RED로 재현하고 차단 GREEN을 확인했다. 잘못된 판단이면 이름 허용 범위 차이가 생기므로 최종 리뷰에서 재검토한다.
- Task 2: Ruling: 변경된 시간순 정렬에 기존 v1 cursor를 혼용하지 않고 400으로 새 조회를 요구한다. v2는 nullable 시각과 필터 binding을 보존한다. 비용은 오래 열린 목록의 재조회다.
- PC UI 신규 5실패/기존 3통과 RED 확인 후 시각 표시와 명시적 해제 구현. 기존 Next 문서와 디자인 지침을 읽었으며 Impeccable detector 결과는 빈 목록이다. 시각 확인/Playwright는 미완료.
- 2026-10-16 재개: 직전 상태 보고 턴은 코드 진척 없음. verify 종료1(테스트 mock 미사용 매개변수 2건)을 재확인하고 타입 선언으로 수정했다. 검사 규칙을 완화하지 않는다.
- Task 1: complete — pnpm verify의 공용 계약176개 통과. 새 시각 계약10개 포함. BASE 8af7a0d 이후 미커밋이므로 커밋 범위 완료를 주장하지 않는다.
- Task 2: complete — 전체 DB413개/37파일/78.55초 종료0, API320개 포함 verify 종료0. exactOptionalPropertyTypes의 cursor time 생략 타입 불일치를 수정했다. 빠른 DB에서 같은 밀리초에 겹친 clock rollback fixture는 최초 baseline을 명시적 과거로 준비해 수정했으며 제품 시계 역행 차단은 유지한다.
- Task 3: complete — 웹1211개와 core Playwright19개/57.4초 종료0. 실제 native API 생성→PC 시각 보존 수정→명시적 해제/재조회와 접근성 검사 포함. 화면 캡처 검토에서 checkbox 정렬만 CSS 보정했고 재확인을 진행한다. 사용자 지침대로 단순 CSS용 테스트 코드는 추가하지 않는다.
- 검증: verify2068개(legacy208/공용176/DB단위19/API320/web1211/mobile48/preflight86), API·웹 build·Android JS/Hermes 번들1370모듈/3.3MB 종료0. 실제 APK가 아니다. Git 대상850파일 등록 비밀 패턴0, 모바일 env/서명키/Expo 캐시 무시 확인. PR22는 OPEN, 원격264a7f6·기존 security-gate 실패이며 이번 로컬 변경을 포함하지 않는다.
- 최종 CSS 확인: PC19개/54.1초/종료0. 1440/390px 캡처에서 체크박스 정렬을 다시 확인했다. 추가 시각 수정 반복은 하지 않는다.
- Final review: fresh read-only reviewer 1회, Critical0/Important0/Minor1. 현재 시간 API와 직접 연결 경계에 한정하며 혼합 branch 전체 리뷰 완료가 아니다.
- Final: minor (deferred): tests/database/transactions-api.test.ts의 구버전 멱등 응답 fixture가 counterpartyName만 제거하고 time은 남긴다. 실제 repository에서 time도 없는 JSON의 재시도 시험을 보강해야 한다. 공용 optional 계약 검증은 존재하고 제품 결함은 발견되지 않았다.
- Final: Ruling: 혼합 Android/auth/collector 변경 전체는 이번 리뷰 범위 밖으로 유지한다. 기존 단위 검증이 전체 PR 검증을 대신하지 않으며 통합 리뷰는 남는다. 잘못 완료로 판단하면 미검토 변경을 배포할 위험이 있다.
- Final: Ruling: APK/실기기/알림 수집/고급 DST UI는 Android 후속 게이트로 유지한다. JS export로 성공을 대체하지 않는다. 생략하면 실제 기기의 권한·시간 입력 결함을 놓칠 수 있다.
- Final: Ruling: 운영 이관/인덱스 잠금/대표 규모 부하는 배포 전 별도 검증한다. 기존 인덱스를 유지한 추가형 이관이지만 무잠금 운영 이관을 보증하지 않는다. 오판하면 서비스 지연이 생길 수 있다.
- Final: Ruling: 서로 다른 Node/PostgreSQL/Android tzdb의 모든 역사적 차이는 보증하지 않는다. 과거 snapshot 유지 원칙과 입력 불일치 거부는 지키며 기기 통합에서 확인한다. 차이가 있으면 특정 시각의 저장 실패/표시 차이가 날 수 있다.
- Final: Ruling: reviewer가 보류한 마지막 checkbox 시각 확인은 main이 PC19개 재검증과 데스크톱/좁은 화면 캡처로 확인했다. Android 시각 검증으로 확대하지 않는다.
- Final: Ruling: 원격 PR/CI/배포 판단은 읽기 결과 OPEN/구 head/인증 분기 커버리지 실패로 유지한다. 이번 로컬 승인으로 원격 병합 가능 판정을 대신하지 않는다. 잘못 판단하면 검증되지 않은 이력을 병합할 위험이 있다.
- 성능 표현: 이력 결과/JS 계산은 최대2행이지만 과거 시각의 DB 검색 비용까지 상수인 것은 아니다. 300개 이력 지원은 실제 시험으로 검증했다.
- Task 4: complete — 최종 post-review verify 세션99358 종료0, output/ledger-time-api-verify-reviewed.log에서 2068개·build·Android JS export 확인. Notion root/04/07 readback 확인. 커밋/운영 적용/앱 전체 완료는 아니다.
