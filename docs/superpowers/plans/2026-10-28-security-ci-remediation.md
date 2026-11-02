# Security dependencies and authentication CI remediation

> Execution: inline using superpowers:executing-plans; preserve existing work and request a fresh final review.

**Goal:** 보안 수정 패키지를 적용하고, 인증 E2E 준비 DB에 빠진 세션 채널 마이그레이션을 포함해 로그인 CI 실패를 해결한다.

**Architecture:** 앱의 인증·동의 정책은 유지한다. 패키지는 현재 메이저 버전 안의 공식 수정 릴리스로 갱신한다. E2E 전용 DB 준비기는 기존 운영 마이그레이션을 재사용한다. 검증은 별도 일회용 PostgreSQL과 테스트 인증 서버에서 수행한다.

**Tech Stack:** Node 22.15.1, pnpm 11.9.0, Next.js 16, NestJS 11/Fastify 5, Expo 57, PostgreSQL 17.11, Vitest, Playwright.

**Spec:** [요구사항·결과 기록](../../status/2026-10-28-security-ci-remediation.ko.md), 사용자의 2026-10-28 보안 패키지 보완·CI 인증 오류 수정 요청.

## Global constraints

- 기존 미커밋 모바일 서버 동의 작업과 `apps/web/next-env.d.ts` 변경은 보존한다.
- 운영 Supabase, 실제 사용자 계정, 비밀번호, 토큰, 환경 파일을 변경하거나 Notion에 전송하지 않는다.
- DB 재생성은 이번 작업이 새로 만든 로컬 일회용 클러스터에만 허용한다.
- 보안 검사 임계값·커버리지·CI 단계를 낮추거나 건너뛰지 않는다. 수정 버전 없는 경고는 공개한다.
- 커밋·푸시·병합은 이번 요청에 포함되지 않는다. 로컬 재현 성공과 GitHub CI 성공을 구분한다.

## Expected files and size

중간 규모, 최초 예상 13개에서 Expo 호환성 테스트와 문자열 길이 호환 보완을 추가해 21개 파일. 잠금파일 외에는 버전/입력 계약/테스트 중심의 작은 변경이며 UI·DB 운영 스키마 변경은 없다.

1. `package.json`: Vitest 및 coverage 4.1.12
2. `apps/web/package.json`: Next 16.4.1, Zod 4.6.6
3. `apps/api/package.json`: Fastify 5.12.6, Zod 4.6.6
4. `apps/mobile/package.json`: Zod 4.6.6 (Expo/RN/React 유지)
5. `packages/contracts/package.json`: Zod 4.6.6
6. `pnpm-workspace.yaml`: Next 선택자와 취약 전이 의존성 override
7. `pnpm-lock.yaml`: 재해결 결과
8. `scripts/workspace-policy.test.mjs`: 수정 버전 고정 및 취약 버전 재유입 차단
9. `tests/database/prepare-auth-e2e.ts`: 기존 native session migration 포함
10. `tests/database/prepare-auth-e2e.test.ts`: 준비 순서 검증
11. `tests/database/prepare-auth-e2e.db.test.ts`: 실제 PostgreSQL 웹/Android 세션 회귀 검사
12. 이 계획서
13. `docs/status/2026-10-28-security-ci-remediation.ko.md`
14. `apps/mobile/tooling/expo-zod-compat.test.cjs`: 실제 Expo CLI의 Zod 소비 코드에 대한 호환성 검사
15. `packages/contracts/src/string-length.ts`: 기존 UTF-16 길이 계약 검사기
16. `packages/contracts/src/string-length.test.ts`: 비밀번호·표시명·메모의 BMP/이모지 경계값
17. `packages/contracts/src/auth.ts`: 기존 비밀번호 12~1024 UTF-16 단위 보존
18. `packages/contracts/src/accounts.ts`: 계좌명 80 단위 보존
19. `packages/contracts/src/categories.ts`: 카테고리명 50 단위 보존
20. `packages/contracts/src/profiles.ts`: 닉네임/이미지 키 길이 보존
21. `packages/contracts/src/transactions.ts`: 거래 상대명/메모 길이 보존

추가 확인: Expo CLI 57.0.31의 전이 Zod 3.25.76에도 high 경고가 남는다. 이 도구만 대상으로 4.6.6을 지정한다. 설치된 플러그인 설정·MCP 매개변수·출력 검증 코드의 정상/거부 동작을 먼저 고정하고, 버전 검사를 RED→GREEN으로 확인한다. 앱의 Expo/RN 메이저는 바꾸지 않는다.

통합 검사에서 발견한 호환 문제: Zod 4.6.6의 문자열 길이는 코드 포인트 기준이다. 기존 HTML/JS와 공유하던 UTF-16 제한을 바꾸면 이모지를 포함한 기존 비밀번호가 로그인에서 거부될 수 있다. 계약 5개 파일에 공용 검사기를 연결하고 별도 경계값 테스트를 RED→GREEN으로 검증한다. ASCII로 제한되는 이메일·커서·IANA 시간대는 영향이 없다.

## Review Focus

1. 취약 버전이 다른 전이 의존성 경로에 남거나 override가 호환성을 훼손하는가? 전체/production audit와 frozen install로 확인한다.
2. CI DB 준비기에 필요한 세션 컬럼뿐 아니라 웹/Android 제약·기본값·BFF 권한도 적용되는가? 실제 PostgreSQL 회귀 테스트와 브라우저 로그인으로 확인한다.
3. 일회용 DB 안전장치가 유지되는가? URL·역할·DB 이름 검증 회귀 테스트와 실행 대상의 격리를 확인한다.
4. 기존 모바일 동의 작업을 덮어쓰거나 인증·보안 검사를 약화하지 않았는가? 작업 시작 상태와 diff를 비교한다.
5. 로컬 성공을 원격 CI/실기기/운영 성공으로 잘못 기록하지 않는가? 최종 보고에 검증 범위를 명시한다.

## Task 1: Dependency security updates

**Interfaces:** manifest + workspace overrides → lockfile → policy tests and all workspaces.

1. 정책 테스트를 목표 버전과 취약 버전 재유입 검사로 먼저 변경한다.
2. Run: `node --test scripts/workspace-policy.test.mjs`.
   Expected: 기존 manifest/lockfile 때문에 실패(RED).
3. 위 5개 manifest와 workspace overrides를 변경하고 `pnpm install` 실행.
   Expected: 엄격한 peer/engine 조건을 유지하며 설치 성공.
4. Run: `node --test scripts/workspace-policy.test.mjs`, `pnpm install --frozen-lockfile`, `pnpm audit --json`, `pnpm audit --prod --json`.
   Expected: 정책·설치 성공; 배포된 수정 버전으로 해결 가능한 경고 제거. `deepmerge`의 공식 미수정 경고는 남을 수 있다.
5. 커밋하지 않고 결과를 실행 기록과 상태 문서에 남긴다.

## Task 2: Authentication fixture regression

**Interfaces:** 기존 `20261016040532_native_session_channel.sql` → 준비 DB → 실제 세션 SQL과 Playwright.

1. 준비 순서 단위 테스트와 실제 DB의 웹 기본값/Android 기기 제약/BFF 조회 테스트 작성.
2. 새 격리 PostgreSQL 17.11 클러스터를 loopback:5432에서 시작하고 `account_book_test` 생성.
3. Run: `pnpm --filter @account-book/database-tests exec vitest run prepare-auth-e2e.test.ts prepare-auth-e2e.db.test.ts`.
   Expected: 누락된 migration/컬럼 때문에 실패(RED).
4. 준비기의 migration 목록 마지막에 기존 native session migration을 추가한다.
5. 같은 명령 재실행.
   Expected: 모든 회귀 검사 통과(GREEN), 일회용 DB 거부 검사 유지.

## Task 3: Integrated verification and handoff

**Interfaces:** Task 1 package graph + Task 2 fixture → 동일 CI 검사 순서.

1. Run: `pnpm verify`; `pnpm --filter @account-book/web test:coverage`; `pnpm test:db`.
   Expected: lint/typecheck/tests/build/coverage/DB 모두 통과.
2. Run: `pnpm --filter @account-book/database-tests prepare:e2e`; `pnpm --filter @account-book/e2e test`.
   Expected: 기존 Playwright PC/모바일 크기 인증 테스트 및 HTTP 테스트 통과.
3. Run: `pnpm audit --prod --audit-level high`; 보안 게이트와 diff 검사.
   Expected: high/critical 없음; 미수정 경고는 명시하고 숨기지 않음.
4. fresh reviewer가 실제 작업 diff와 위 Review Focus를 확인한다. 중요한 발견은 재현 테스트 후 수정한다.
5. 작업용 PostgreSQL 정지. Notion 및 상태 문서에 변경·테스트 수·남은 위험·원격 CI 미실행을 기록한다.
6. 커밋/푸시 없이 검증된 로컬 결과와 후속 단계를 전달한다.
