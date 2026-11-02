# Android Session Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹/Android 세션의 교차 사용을 막는 서버 저장·조회·갱신·철회 경계를 만든다.

**Architecture:** 기존 암호화 세션 저장소를 재사용하고 서버 구성으로 채널을 고정한다. 추가형 migration으로 기존 행을 웹 세션으로 보존한다. 모바일 HTTP/UI 및 단일 수집 기기 API는 다음 단위다.

**Tech Stack:** TypeScript, 기존 Node/NestJS/Next.js 인증 기반, Drizzle, PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-native-session-boundary-design.md`

## Global Constraints

- Android 먼저, iOS 후속. 실계좌·운영 배포·hosted DB 변경 없음.
- 기존 7일 유휴/30일 절대 수명과 암호화·복구 철회 보존.
- 요청자 `mobile` 헤더를 권한으로 사용하지 않음. 기기 UUID는 하드웨어 증명이 아님.
- 서버 키·원문 알림·실제 금융/사용자 정보는 fixture·로그·문서에 넣지 않음.
- 기존 미커밋 A5·원장·인증 변경 보존. 이번 변경만 검토하며 자동 커밋/푸시하지 않음.

## Review Focus

- Android 세션을 웹 쿠키 자리에 넣어도 조회/갱신/철회가 되지 않는가.
- 웹 세션에 임의 기기 ID를 붙이거나 잘못된 DB 채널을 허용하지 않는가.
- 제공자 갱신이 채널/기기 정보를 덮어쓰지 않는가.
- 전체 로그아웃/비밀번호 복구가 두 채널 모두 철회하는가.
- migration 선적용 시 기존 웹 행/INSERT와 최소권한이 유지되는가.

### Task 1: 세션 채널 저장과 서비스 경계

**Files:**
- Modify: `packages/database/src/schema/auth.ts`
- Modify: `apps/web/src/server/persistence/auth-repository.ts`
- Modify: `apps/web/src/server/persistence/postgres-auth-repository.ts`
- Modify/Test: `apps/web/src/server/session/session-service.ts`, `session-service.test.ts`
- Modify/Test: `apps/web/src/server/persistence/postgres-auth-repository.test.ts`, `postgres-auth-repository.test-fixtures.ts`
- Create: CLI가 생성한 `supabase/migrations/*_native_session_channel.sql`
- Create/Test: `tests/database/native-session-channel.test.ts`
- Modify: `tests/database/auth-recovery-skew.test.ts`, `tests/e2e/core/setup.ts`
- Modify: `apps/web/vitest.config.ts` (새 문맥 검사도 기존 보안 커버리지 게이트에 포함)
- Create: `apps/web/src/server/security/session-context.ts` (공통 문맥 검증)
- Modify/Test: `apps/web/src/server/bank-connections/bank-controller.test.ts`, `apps/web/src/server/core/core-controller.test.ts` (기존 웹 세션 fixture 보완)

**Interfaces:**
- Consumes: 기존 `AuthSessionRecord`, `SessionService`, `PostgresAuthRepository`.
- Produces: `clientChannel: "web" | "android"`, `deviceId: string | null` 저장; 서비스 생성자의 고정 채널; Android 생성 시 `deviceId`; 채널 조건 포함한 `revokeBySelectorHash`.

- [x] Step 1: 채널별 생성/교차 조회·갱신/잘못된 기기 ID 시험부터 추가하고 미구현 실패 확인.
- [x] Step 2: CLI로 migration 생성, DB CHECK·기존 기본값·권한·양방향 철회·전체 철회 시험 추가 후 미구현 실패 확인.
- [x] Step 3: 필드/저장소/서비스의 최소 변경. 생성·복호화 전 검증, 철회 SQL 채널 조건, 회전 시 문맥 유지.
- [x] Step 4: 단위·DB 시험 및 기존 웹 전체 회귀 실행. 실패는 원인과 수정 기록.
- [x] Step 5: PC Playwright 로그인·복구·로그아웃 회귀와 독립 보안 리뷰. 이번 단위와 미완료 모바일 기능을 구분해 MD/Notion 기록.

## 실행 기록

- Pre-flight: 서비스가 저장한 채널/기기를 저장소가 유실 없이 반환해야 하며, 기존 fixture도 웹 문맥을 명시한다.
- Ruling: 기존 실행 승인과 반복 승인 생략 요청에 따라 직접 구현한다. 제품 범위는 바꾸지 않고 기술 선행 단위를 분리한다.
- Ruling: 기존 작업이 섞인 브랜치 전체를 자동 커밋/배포하지 않는다. 이번 단위 diff와 원격 PR 전체 리뷰를 혼동하지 않는다.
- `autoplan`의 하위 리뷰 참조 경로가 없어 전체 자동 파이프라인 완료로 표시하지 않는다. 직접 설계 대조·TDD·독립 보안 리뷰로 보완한다.
- 변경 계획 보정: 공통 core DB 생성기를 바꾸지 않고 실제 BFF 저장소를 쓰는 recovery/core E2E setup에 새 migration을 추가한다. 별도 DB 시험에서는 이관 전 행을 만든 뒤 migration을 적용해 업그레이드를 검증한다.
- TDD: 서비스/저장소 16개 실패 → 72개 통과, 새 실제 DB 시험 8개 실패 → 13개 통과. 전체 DB 319개 통과.
- 중간 실패: 전체 타입 검사에서 기존 컨트롤러 대역 2곳이 새 반환 필드를 생략해 실패. 실제 반환형과 동일하게 웹 문맥을 추가하고 전체 검증 재실행.
- 독립 리뷰: 이번 단위의 Critical/Important/Minor 0건. 전체 PR·운영 배포 승인으로 확대하지 않는다.
- 최종 전체 `pnpm verify` 종료 0: 린트·6 workspace 타입·1,760개 테스트·API/웹 production build 통과. 중간 실패 후 재실행한 결과다.
- 웹 coverage 1,072개 테스트 통과, 선택된 인증/보안 20파일의 분기 855/855(100%). 프로젝트 전체 100%가 아니다.
- 실제 폐기용 PostgreSQL 통합 319개(27파일), core PC Playwright 15개 통과. 마지막 PC 실행 40.2초·종료 0. 시험용 서버와 이 작업에서 시작한 폐기용 PostgreSQL을 종료했다.
- 의존성 감사 알려진 경고 0건. 상세 범위·초급 개발자용 설명·남은 작업은 [결과 보고서](../../status/2026-10-16-native-session-boundary.ko.md)에 기록한다.
- 문서 반영 후 tracked/non-ignored untracked 731파일의 기존 비밀 패턴 검사 0건·diff 공백 검사 통과. 모든 비밀 유형이나 Git 전체 이력을 증명하는 검사는 아니다. Notion 04·07의 비동기 갱신 성공과 재조회된 내용/체크 상태를 확인했다.
