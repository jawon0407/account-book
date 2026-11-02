# 일반 거래 수정·삭제 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. 이 계획은 기존 거래 계약과 사용자의 후속 진행 승인을 실행한다.

**Goal:** PC에서 본인 수입·지출을 수정하고 삭제 확인 후 원장에서 제외한다.
**Architecture:** Next BFF → 위임 JWT → Nest → 최소 권한 PostgreSQL. 기존 version 트리거·RLS·잔액 집계를 재사용한다.
**Tech Stack:** TypeScript, Nest/Fastify, Next, ky, React Query, PostgreSQL, Vitest, Playwright.
**Spec:** 2026-08-26-ledger-public-contracts-design.md 및 2026-09-30-transaction-entry.md의 후속 범위.

## Global Constraints

- 현재 feature/bank-state-transitions worktree와 미커밋 인증 수정을 보존한다. 별도 지시 없는 커밋·푸시·실제 금융 행 변경은 하지 않는다.
- 일반 수입/지출만 PATCH/DELETE `/v1/transactions/:id`, BFF `/api/transactions/:id`로 제공한다. 이체·시작 잔액은 거부한다.
- 기대 버전(expectedVersion) 필수. 행 잠금 후 버전을 검사하여 다른 기기의 변경을 덮어쓰지 않는다.
- deleted_at soft delete, tombstone 응답. 이미 삭제됐거나 타인/없는 ID는 같은 404. DELETE 물리 권한 추가 없음.
- 보관된 기존 계좌/분류는 유지할 수 있지만 새 참조는 활성 상태여야 한다. 종류 변경 시 분류 종류도 일치해야 한다.
- memo 생략은 유지, null은 비우기. 수정/삭제 재시도는 자동 수행하지 않는다.
- 네트워크/응답 불명확 또는 충돌 시 폼을 잠그고 최신 목록 확인을 안내한다. 성공 응답 전 목록을 낙관적으로 바꾸지 않는다.
- 함수 역할·매개변수 주석, 한국어 개발 설명, 기능별 Notion 체크리스트를 갱신한다.

## Review Focus

사용자 격리, CSRF·위임 scope/메서드 결속, CAS 경쟁, 보관 참조, 삭제 후 잔액, 응답 유실·연속 클릭, 접근성·PC 브라우저 실제 경로.

## Task 1 — Nest/DB

- [x] 실제 폐기용 DB RED: 수정·memo null·계좌/종류 변경·권한·충돌·보관·soft delete·잔액.
- [x] transactions.repository.ts에서 새 transaction-changes.ts로 변경 책임 분리, controller PATCH/DELETE 추가.
- [x] GET 상세는 목록의 전체 snapshot으로 편집하므로 이번에 추가하지 않는다. stale version은 재조회 후 새 편집으로 해결한다.
- [x] DB GREEN 및 API HTTP 경계 검증.

## Task 2 — BFF/ky

- [x] operations.ts와 `api/transactions/[id]/route.ts`: 닫힌 작업표·UUID·입력/출력 검증.
- [x] ky update/remove, CSRF·계정 assertion·retry0·no-store. BFF/ky RED→GREEN.

## Task 3 — PC

- [x] transaction-edit-form.tsx, transaction-delete-form.tsx와 목록 행동 연결. 기존 생성 재시도 로직 유지.
- [x] 실패/충돌 입력 보존, 불확실 결과의 재전송 금지, 삭제 대상/영향 명시, native dialog 포커스.
- [x] Playwright 합성 인증 + 실제 Nest/폐기용 DB로 수정·삭제·잔액·경쟁·응답 유실 검증.

## Task 4 — 통합/문서

- [x] lint/typecheck/전체 테스트/build, DB 테스트 순차 실행, 최종 독립 리뷰.
- [x] 한국어 개발 흐름·진행 기록·Notion 결과 갱신. 로컬 HTTPS 서버 복구.

규모 예상: 테스트·문서 포함 20~30파일. 새 유료 서비스/secret/운영 migration 없음.
2026-10-01 인증 성공은 사용자가 확인했다. 이는 모든 실제 소셜 공급자 검증 완료를 뜻하지 않는다.
