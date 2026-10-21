# Android Collector Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 단일 수집 기기 HTTP 계약을 Android 설정 UI에 연결한다.

**Architecture:** HTTP 계약/세션 권한/설정 상태/화면을 분리한다. 모든 변경에 확인과 기대 버전을 적용하고 불확실한 결과는 조회로 해소한다.

**Tech Stack:** 기존 TypeScript, React Native/Expo, zod, Vitest. 의존성 추가 없음.

**Spec:** `docs/superpowers/specs/2026-10-21-android-collector-settings-design.md`

## Global Constraints

- 서버·DB·의존성 변경 없음. 토큰·기기 ID를 UI 입력으로 받지 않는다.
- 실제 알림 접근/자동 기록은 미구현이며 이를 화면에서 명확히 안내한다.
- 기존 Bookify theme와 48dp 터치 영역 사용, 뒤로 가기/수기 초안 유지.
- PATCH 자동 재전송 없음. 실패 후 GET; GET 실패 시 변경 잠금.
- 기존 기능 브랜치에서 진행. 테스트 계정과 폐기용 로컬 DB만 사용한다.

## Review Focus

- effect start/stop/start와 늦은 응답이 새 화면을 오염하지 않을 것 (Task 2).
- 확인 후 연타/새로고침이 두 PATCH를 만들지 않을 것 (Task 2).
- 서버 저장 후 응답 유실을 실패/성공으로 단정하지 않을 것 (Task 2).
- logout/foreground 검증 중 완료된 응답을 공개하지 않을 것 (Task 1).
- 실제 수집 미지원 문구, 화면 확대·Back·확인 취소가 사용자를 오도하지 않을 것 (Task 3).

### Task 1: HTTP와 세션 연결

**Files:** Create `apps/mobile/src/api/native-collector-client.ts`, `native-collector-client.test.ts`, `apps/mobile/src/auth/session-collector.test.ts`; modify `apps/mobile/src/api/native-client.ts`, `apps/mobile/src/auth/session-manager.ts`, `apps/mobile/tsconfig.core.json` and existing session test fixtures if required.

**Interfaces:** Consumes `CollectorChangeInputSchema`, `CollectorStateSchema`. Produces `NativeClient.collector.read(token):Promise<CollectorState>`, `.change(token,input):Promise<CollectorState>` and `SessionManager.collectorState()`, `.changeCollector(input)` with no public token.

- [ ] Add failing tests: GET/PATCH fixed path + Bearer/omit cookies; strict injection/invalid success rejected; PATCH 503 exactly one request; signed-out blocks reads/writes; 401 clears session; logout/revalidation drops late response; refresh-required rotates but does not replay.
- [ ] Run `pnpm --filter @account-book/mobile exec vitest run src/api/native-collector-client.test.ts src/auth/session-collector.test.ts`. Expected: new methods absent.
- [ ] Implement API adapter and SessionManager wrappers through existing authenticatedRequest; include new files in core typecheck.
- [ ] Same command. Expected: PASS. Run mobile typecheck, expected PASS.
- [ ] Commit `feat(mobile): connect collector settings API` with this plan/spec and API changes.

### Task 2: 설정 상태 모델

**Files:** Create `apps/mobile/src/collector/collector-settings.ts`, `collector-settings.test.ts`, `collector-copy.ts`, `collector-copy.test.ts`; modify core tsconfig include.

**Interfaces:** Consumes SessionManager methods from Task 1. Produces `CollectorSettings.start/stop/reload/choose/confirm/cancel`, `snapshot/subscribe`. State has phase (`idle/loading/ready/saving/error`), value, confirmation, notice. Copy helpers return fixed Korean labels, no raw errors.

- [ ] Add failing tests for all three server states; confirmation cancellation; explicit replacement true; deactivate current/other; duplicate click; conflict/network failure triggers GET only; GET failure locks; reload clears old confirmation; stop drops response; start after stop re-reads.
- [ ] Run `pnpm --filter @account-book/mobile exec vitest run src/collector`. Expected: missing modules fail.
- [ ] Implement lifecycle epoch and fixed copy; never optimistic success; failure notices remain even when GET succeeds.
- [ ] Same command. Expected PASS. Run mobile typecheck, expected PASS.
- [ ] Commit `feat(mobile): guard collector settings transitions`.

### Task 3: 설정 화면과 통합 검증

**Files:** Create `apps/mobile/src/ui/collector-screen.tsx`, `docs/status/2026-10-21-android-collector-settings.ko.md`; modify `apps/mobile/src/ui/ledger-flow.tsx`, `ledger-screen.tsx`, `apps/mobile/src/ledger/manual-workspace.ts`, `manual-workspace.test.ts`, `apps/mobile/README.md`.

**Interfaces:** Consumes Task 2 model; extends ManualWorkspaceScreen with `collector`; LedgerScreen `onCollector`; CollectorScreen receives manager/onBack. No new persistent storage.

- [ ] Add failing workspace navigation test: manual draft unchanged after collector → ledger → manual, logout clears owner data.
- [ ] Run `pnpm --filter @account-book/mobile exec vitest run src/ledger/manual-workspace.test.ts`. Expected new collector screen type/behavior required.
- [ ] Build screen with existing tokens, fixed copy, confirmation/cancel, refreshing and locked failure states. Wire navigation and Back.
- [ ] Run mobile tests/typecheck and Android export. Expected PASS; inspect real-device screenshots if available. Do not substitute browser renders for native UI.
- [ ] Run full lint/typecheck/tests and PC Playwright regression. Expected PASS, no live sensitive data.
- [ ] Fresh code review and independent native visual review (when screenshots available); document actual evidence and limitations in MD/Notion. Commit `feat(mobile): add collector settings screen` after checks. Push feature branch only; no merge/deploy.

## Self-review

3 tasks share only the named contracts above; all spec requirements map to a task. No new user policy decisions. Existing instruction to continue approved work without routine approval loops selects inline execution with final independent review.
