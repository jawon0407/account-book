# 알림 접수 후속 테스트 보강 계획

**Goal:** 이전 리뷰의 Minor 2건을 실제 HTTP 구성과 PostgreSQL 경계 시험으로 보호한다.
**Architecture:** 제품 제공자·저장소·시간대 선택은 그대로 실행한다. 외부 DB 연결만 HTTP 시험에서 차단하고, SQL 시험은 기존 폐기용 DB fixture를 사용한다.
**Tech Stack:** Node 22.15.1, pnpm 11.9.0, NestJS/Fastify, Vitest, PostgreSQL 17.
**Spec:** [서버 기반 설계](2026-11-02-notification-ingestion-foundation.md). 기준 커밋 `4b167d8`.

## 범위와 변경 파일

- 신규 `apps/api/src/core/notification-ingestion-disabled.regression-1.test.ts`: 실제 AppModule/CoreModule 제공자에서 서명된 Android POST/GET이 503이고 접수 DB 접근은 0회인지 확인.
- 신규 `tests/database/notification-time.regression-1.test.ts`: 거주 변경 전 지연 도착, 정확한 변경 시점, 분 단위 구간 내부 변경 거절 시 미저장 확인.
- 이 계획 및 `docs/status/2026-11-02-notification-test-hardening.ko.md`: 결과·한계·모바일 후속 단계 기록.
- 예상 4파일, 약 250~350줄. 제품 코드·스키마·의존성·CI·화면 변경은 예정하지 않는다.

## 공통 제한

- 실제 금융 알림, 실계정, 운영 Supabase에 접근하지 않는다.
- 기본 비활성 제공자, 기존 동의 안내, 보안 기준을 유지한다.
- 기존 테스트를 약화하거나 시험 전용 제품 플래그/함수를 만들지 않는다.
- 정상 계약의 누락 시험 보강이다. 결함이 재현되지 않으면 제품 수정을 만들지 않는다.
- QA → 이번 변경과 관련 경로의 독립 review → CSO 순서. 전체 장기간 PR 보안 인증으로 과장하지 않는다.
- 로컬 검증 커밋은 QA 절차에 따라 분리한다. 원격 푸시·병합·배포는 이번 범위에 없다.

## Task 1: 실제 런타임 비활성 경계

- [x] 기존 서명 HTTP fixture 패턴과 실제 제공자 구성을 확인한다.
- [x] 저장소/컨트롤러/UserDatabase는 대체하지 않고 풀의 연결·질의가 호출되면 실패하는 경계를 둔다. JWT 검증은 실제 ES256, 재사용 저장소만 메모리 합성 구현을 사용한다.
- [x] 올바른 Android `notification:write` POST 및 `notification:read` GET 모두 503/LEDGER_SERVICE_UNAVAILABLE, no-store, DB 접근 0회. 인증 없는 요청은 401.
- [x] `pnpm --filter @account-book/api test src/core/notification-ingestion-disabled.regression-1.test.ts` 실행.

## Task 2: 거주 변경 SQL 경계

- [x] 폐기용 DB에 합성 회원·동의·수집 세션과 서울→로스앤젤레스 이력을 구성한다. 과거 이력 시각을 넣는 시험 fixture에서만 삽입 trigger를 잠시 해제한다. 같은 transaction에서 재활성화 후 commit하고, 실패하면 finally rollback으로 복원한다.
- [x] 변경 전 거래가 변경 후 도착해도 이전 시간대와 날짜를 저장한다.
- [x] 변경 시각과 정확히 같은 거래는 새 시간대/전날 날짜를 저장한다.
- [x] 변경이 분 단위 구간 안에 있으면 409/LEDGER_TIME_REVIEW_REQUIRED, 원장·접수 행 모두 0개.
- [x] 구간 끝과 변경 시각이 같으면 기존 시간대, 구간 시작이면 새 시간대를 선택하는 인접 경계도 표로 검증한다.
- [x] `pnpm --filter @account-book/database-tests test notification-time.regression-1.test.ts` 실행.

## 완료 조건

- [x] 전체 자동 테스트, 전체 DB 통합 검사, 타입·lint·공백 검사.
- [x] QA 근거 보고서, 독립 review, CSO 결과를 구분해 기록. 불가 항목은 차단/미검증으로 명시.
- [x] 노션 진행 일지와 결과 MD 갱신.
- [x] 다음 모바일 전송 작업의 파일 후보·구현 순서·활성화 전 조건 정리. 실제 전송은 이번에 켜지 않는다.

## Review Focus

503만 검사하면 활성화 후 DB 오류도 오탐할 수 있으므로 DB 접근 0회를 함께 검사한다. HTTP의 JWT 재사용 저장소는 합성이며 운영 인증 DB 무접근을 주장하지 않는다. DB 경계 기대값은 제품 시간 변환 함수를 쓰지 않고 고정 날짜로 계산한다. 거절 시 조회 목록만 비어 있는 것이 아니라 실제 원장과 접수 표의 행 수를 확인한다. 시간 이력 fixture는 이력 생성 trigger 자체를 검증하지 않는다.

## 완료 기록

- 결과: [상세 보고서](../../status/2026-11-02-notification-test-hardening.ko.md).
- 일반 테스트2,430건·DB451건, 타입·lint 통과. 신규 시험7건 포함.
- QA pass. 이번 변경 범위 독립 review0건. CSO partial(정적 검토0건, Windows 자동 스캐너 미지원).
- 노션 개발일지407323168ba6815187d1c47ed95c9de2에 결과·후속 순서 기록 완료.
- 로컬 테스트 커밋c1dbdfe /7568728. 원격 푸시·운영 활성화 없음.
