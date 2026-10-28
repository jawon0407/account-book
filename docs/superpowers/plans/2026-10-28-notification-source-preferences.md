# Notification Source Preferences Implementation Plan

> **Superseded 2026-10-28:** User requested one notification permission button, without the fixed source list. The six source-preference implementation/test files have been removed from the current worktree. Historical results below describe the prior state. Current plan: [notification permission entry](2026-10-28-notification-permission-entry.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. The user requested continuous execution without routine approval loops. No commit/push is requested for this work.

**Goal:** Android에서 현재 계정의 준비용 알림 출처 선택을 명시적으로 저장·복원한다.

**Architecture:** 순수 출처 목록/검증, 보안 저장 어댑터, 화면 수명 상태 모델, 기존 화면의 별도 패널로 분리한다. 서버·권한·본문 처리 기능을 호출하지 않는다.

**Tech Stack:** TypeScript, Zod, React Native, existing Expo SecureStore/Crypto, Vitest.

**Spec:** `../specs/2026-10-28-notification-source-preferences-design.md`

## Global Constraints

- 기본 선택 없음. 저장 버튼 전에는 초안만 변경.
- origin/userId/deviceId별 보안 저장. generation은 화면 응답 격리에 사용하고 영구 키에는 넣지 않음.
- 수집 시작/동의/OS 권한/금융 원문에 부작용 없음. 실제 수집 중이라고 표시하지 않음.
- 기존 session-manager 431줄에 새 기능을 몰아넣지 않음. 기존 의존성만 사용.
- 기존 worktree/기능 브랜치 유지. 커밋·푸시·운영 DB 변경 없음.

## Review Focus

- 계정 변경 중 늦은 읽기/쓰기 결과가 새 화면에 노출되지 않는지.
- 알 수 없는 출처/잘못된 저장 버전이 자동으로 빈 값으로 덮어써지지 않는지.
- 저장 중 연타가 쓰기를 중복시키거나 초안을 바꾸지 않는지.
- 저장 실패 안내에 내부 오류나 계정 식별자가 포함되지 않는지.
- 준비용 출처 선택이 실제 수집 허용·시작으로 오해되지 않는지.

### Task 1: 출처 계약과 계정별 보안 저장

**Files:** Create `apps/mobile/src/collector/notification-sources.ts`, `source-preferences-store.ts`, `source-preferences-store.test.ts`.

**Interfaces:** `SourceId`, `SourceScope`, `SOURCE_OPTIONS`, `SourcePreferencesStore(storage, digest).read(scope): Promise<readonly SourceId[]>`, `.write(scope, selected): Promise<void>`. storage는 기존 SessionStorage, digest는 문자열 SHA-256 hex Promise.

- [x] 기본 빈 선택, 저장/복원, origin/user/device 격리, 중복/미지 출처·버전 거부, 저장 실패 전달 테스트를 먼저 작성한다.
- [x] `pnpm --filter @account-book/mobile exec vitest run src/collector/source-preferences-store.test.ts` → RED 확인.
- [x] strict Zod 검증, SHA-256 키, 최소 선택 payload를 구현하고 같은 시험 GREEN 확인.

### Task 2: 화면 수명 모델과 React Native 패널

**Files:** Create `apps/mobile/src/collector/source-preferences.ts`, `source-preferences.test.ts`, `apps/mobile/src/ui/notification-sources-panel.tsx`; modify `collector-screen.tsx`(연결 2줄), `notification-access-panel.tsx`(준비 기능 안내 1문장), 기존 모바일 surface brief.

**Interfaces:** `SourcePreferences(getScope, store)`의 `start/stop/reload/toggle/save/snapshot/subscribe`; state는 phase, selected, saved, notice. Task 1의 source/scope/store 계약을 사용한다. UI에서 기존 SecureStore와 Expo Crypto를 주입한다.

- [x] 명시적 저장, 전체 해제, 저장 중 연타/토글 차단, 실패와 재조회, 종료·계정 변경·재진입 뒤 늦은 응답 테스트를 먼저 작성한다.
- [x] 해당 모델 시험 → RED 확인 후 최소 구현 → GREEN 확인.
- [x] 기존 화면 아래 복수 선택 패널을 연결한다. 체크박스 접근성·최소 터치 영역·저장 전후 안내·준비 기능 고지를 유지한다.
- [x] `pnpm --filter @account-book/mobile test`, `pnpm --filter @account-book/mobile typecheck`, `pnpm lint`, `pnpm test` → exit 0 확인. 모바일 243+14, 전체 2,330개.
- [x] 실기기에서 선택 저장/재진입·앱 재실행 복원/전체 해제 확인. PC Playwright 로그인·계좌 화면·로그아웃 회귀. UI 검증 한계는 명시.
- [x] 새 검토자가 코드·보안·실기기 화면을 함께 검토했다. Important 저장 순서 문제 1건을 RED→GREEN으로 수정하고 전체 테스트를 재통과했다. 문서·Notion 기록 완료, 커밋 없이 인계한다.

완료 범위는 출처 선택 저장이다. 실제 알림 수집·시작/중지는 후속 단위다. 상세 근거와 미검증 범위는 `docs/status/2026-10-28-server-consent-device.ko.md`에 기록했다.
