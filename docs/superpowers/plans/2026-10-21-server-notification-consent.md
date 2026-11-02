# Server Notification Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 사용자의 연속 진행 지시에 따라 직접 구현하며 최종 독립 리뷰를 받는다.

**Goal:** 서버 동의/철회와 자동 기록 안전장치를 폐기용 DB에서 검증한다.
**Spec:** `docs/superpowers/specs/2026-10-21-server-notification-consent-design.md`
**Architecture:** private SQL 함수 → Nest 저장소/제어기 → 기존 Android BFF. 로컬 모바일 동의는 자동 이관하지 않는다.
**Tech Stack:** 기존 PostgreSQL/Drizzle/Zod/Nest/Fastify/Next/Vitest/Playwright. 새 런타임 의존성 없음.

## Global Constraints

- 기존 worktree와 기능 브랜치 재사용. 별도 Next 자동 생성 변경 보존.
- 운영 DB/배포/실제 알림 수집 없음. 계정/설치 식별자는 인증 세션에서만 얻는다.
- 이전 완료 작업 커밋/푸시는 ae6743e로 완료. 이번 서버 단위는 검증 후 별도 커밋하며 배포하지 않는다.
- 예상 20~25파일, DB/서버 보안 로직을 포함한 중간 규모. 문서와 Notion을 먼저 기록한다.

## Review Focus

- 최초 철회 뒤 늦은 accept, 철회 후 재동의한 경우의 옛 버전 쓰기.
- 같은 회원의 다른 설치/다른 회원/웹 세션/만료 또는 철회 세션 격리.
- writer와 철회가 경쟁할 때 잠금 순서·commit 경계와 실패 시 부분 저장 없음.
- API/BFF가 request body의 identity를 사용하거나 실패한 PATCH를 재전송하지 않는지.
- 현재 UI는 로컬 동의이며 서버 API 연결/실수집 완료로 오인시키지 않는지.

### Task 1: 서버 계약과 DB

**Files:** 신규 `packages/contracts/src/notification-consent.ts` 및 시험; index export. 공식 CLI 생성 migration; 신규 `packages/database/src/schema/notification-consent.ts` 및 index export. 신규 `tests/database/support/notification-consent-fixtures.ts`, `notification-consent.test.ts`, `notification-consent-concurrency.test.ts`.
**Interfaces:** NotificationConsentChangeInput/State; SQL notification_consent_status(session), notification_consent_change(session,expected,action,notice), lock_notification_collector(session,leaseVersion,consentVersion).

- [x] 계약·DB 실패 시험 먼저 작성 후 실행. Expected: export/SQL 함수 부재로 실패.
- [x] 소유권/세션/최소 권한/버전/잠금 구현. Expected: 계약·DB 시험 통과.
- [x] 실제 API 역할로 재동의/철회/지연·다른 설치·동시성 검증.

### Task 2: Nest/API 실행기

**Files:** 신규 `apps/api/src/collector/notification-consent.repository.ts`, `.test.ts`, `.controller.ts`; 수정 core.module.ts, core-http.test.ts, user-database.ts/test.ts, tests/database/collector-runner.test.ts.
**Interfaces:** repository get/change; GET/PATCH /v1/collector/consent; runCollector(userId,sessionId,leaseVersion,consentVersion,operation).

- [x] HTTP·저장소·실행기 부재 실패 확인. Expected: 새 endpoint/동의 검사 미구현 실패.
- [x] 닫힌 오류, Android scope, 동일 transaction 동의 검증 구현.
- [x] API 시험 및 실제 DB 실행기 통과. Expected: 동의 없거나 이전 버전이면 callback 실행 없음, 수기는 유지.

### Task 3: BFF와 종합 검증

**Files:** 신규 apps/web/src/app/api/native/collector/consent/route.ts; 수정 server/core/operations.ts, native-core-controller.test.ts, native-routes.test.ts. 신규 상태 문서, 기존 모바일 README/실기기 가이드/체크포인트 결과 문서 갱신.
**Interfaces:** consentGet/consentChange 고정 operation. 브라우저 쿠키나 body 신원으로 사용할 수 없음.

- [x] BFF/route 시험 RED→GREEN. GET/PATCH 이외 차단과 입력·반환 계약 검증.
- [x] 전체 test/typecheck/lint와 DB 시험, PC Playwright 회귀. Expected: 모두 통과, 미실행 항목은 명시.
- [x] 독립 코드 리뷰 및 중요 지적 수정·회귀 후 별도 커밋. Notion/MD 결과 기록.
- [x] 사용자의 모바일 직접 실행 조건(개발 APK·PC/USB/Metro/HTTPS)과 독립 배포본과의 차이 안내.

## 실제 진행

기능 단위는 `0bb7ab6`(28파일, +808/-26줄). 역할 보존 회귀 시험과 실행 안내를 추가해 예상 파일 수보다 늘었다. 독립 리뷰 Important 1은 테스트에서 기존 공유 역할을 바꾸는 코드였으며 제거하고 실제 상태 보존 비교·독립 연결 정리로 수정했다. 관련 DB 13개와 전체 2,253개·린트/타입 재통과 후 보완 내용을 별도 커밋한다. 전체 결과·advisors 연결 제한·다음 적용 경계는 [결과 문서](../../status/2026-10-21-server-notification-consent.ko.md)를 따른다.
