# Ledger time contract implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded unit. Preserve unrelated uncommitted work; do not commit/push the mixed branch implicitly.

**Goal:** Android 수기 기록의 선행 조건인 날짜/시각 근거와 거주 시간대 선택을 검증 가능한 공용 코드로 제공한다.

**Architecture:** 기존 DTO는 그대로 둔다. 공용 계약 모듈의 순수 함수가 UTC 순간과 명시적인 이력을 받아 snapshot을 만들거나 확인 필요를 반환한다.

**Tech Stack:** TypeScript, Zod, Intl, Vitest; 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-10-16-ledger-time-contract-design.md`

## Global constraints

- Android 먼저, iOS 후속. 기존 DATE에 가짜 시간을 채우지 않는다.
- 운영 DB·환경변수·기존 거래 HTTP·PC UI를 변경하지 않는다.
- 근거 user/notification/device_received와 정밀도 day/minute/second/millisecond를 혼동하지 않는다.
- 기존 미커밋 파일 보존. 마지막 전체 테스트와 범위 독립 리뷰를 수행한다.

## Review focus

- DST 중복 시각: 두 UTC 순간이 합쳐지지 않는다.
- 거주 변경 직전의 분 단위 시각: 구간이 전환을 걸치면 확인 필요다.
- 지연 접수: 현재/수신일이 아닌 발생 시각으로 이전 기준을 찾는다.
- 런타임/기기 시간대: 결과는 명시한 기준만 따른다.
- 큰/잘못된 입력: strict 검증, 256 이력 상한, 유효하지 않은 날짜/시간대 실패.

## Task 1: 공용 계약·변환·거주 이력 선택

**Files:** 신규 `packages/contracts/src/ledger-time.ts`, `ledger-time.test.ts`; 수정 `packages/contracts/src/index.ts`.

**Interfaces:** `LedgerTimeEvidenceSchema`, `ResidenceTimeHistorySchema`, `preserveDateOnlyLedgerTime(date)`, `buildTimedLedgerTime(evidence, ledgerTimeZone)`, `selectResidenceTimeZone(evidence, history)`. 마지막 함수는 `{status:'resolved',timeZone}` 또는 `{status:'confirmation_required',reason}`를 반환한다. 근거/이력은 호출 시 검증한다.

- [x] 날짜 보존·UTC 정밀도·지역 날짜·DST·거주 변경·추정/경계/입력 제한 시험 41개 작성.
- [x] `pnpm --filter @account-book/contracts test -- ledger-time`에서 새 모듈 부재 RED 확인(기존 124개 통과).
- [x] 최소 순수 구현과 index export 추가 후 공용 계약 165개 GREEN 확인. 이 스크립트의 `--` 전달상 전체 공용 패키지가 실행되었다.
- [x] 최종 verify 2,051개·타입·린트·Android 번들/API/웹 build 통과. PC Playwright 18개/39.8초. 네이티브 실기기 성공과 구별.
- [x] 독립 범위 리뷰 Important1건을 정상 정렬257개 RED(계산257회)→GREEN(0회)으로 수정. 최종 새 시험42개/공용166개.
- [x] 상태 MD·Notion 최상위/04/07에 구현/미구현 범위를 분리해 기록했다. 비동기 저장 성공 및 다시 읽기로 2,051개/시각 계약/07 새 절 1개를 확인했다.

## Execution ledger

- 기존 worktree/branch 사용. 전체 자동 autoplan은 설치 참조 누락 때문에 이전 보고처럼 미완료 상태를 유지한다.
- Ruling: 시각 기능 전체가 아니라 순수 계약을 먼저 분리한다 — 현행 API가 날짜만 저장하므로 UI가 버리는 시간을 입력받는 것을 방지 — 다음 DB/API 연결 단위가 필요하다.
- Ruling: commit/push는 보류한다 — 기존 대규모 혼합 미커밋 작업의 범위 확정 없이 묶지 않는다 — 원격에는 이번 결과가 아직 없다.
- 실행 스크립트는 bash 기반이고 현재 PATH에 bash가 없어 이 계획의 checkbox/ledger를 동일 기록으로 사용한다. 운영 DB 변경이나 임의 커밋은 하지 않는다.
- 독립 리뷰: Important 1건(배열 max 검사가 항목별 Intl 계산보다 늦음). 정상 정렬 256개 수용/257개 거부·Intl 0회 시험이 257회로 RED였고, 앞단 크기 검증으로 수정한다.
- 리뷰 범위 밖 판단: DB/API/UI·소유권/RLS·알림 추출·Android 시간대 데이터·migration·저장 이력 정정·기존 미커밋 변경은 이번 모듈의 완료 증거가 아니다. 각 후속 저장/앱 단위의 필수 검증으로 유지한다.
- Task 1 구현/검증 완료: 최종 `pnpm verify` 종료0, `pnpm --filter @account-book/e2e test:core` 종료0. 새 커밋 없음, 혼합 작업 보존.
