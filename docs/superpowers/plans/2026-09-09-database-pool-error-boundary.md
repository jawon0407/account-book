# DB Pool Error Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking.

**Goal:** BFF·API의 유휴 DB 연결 오류를 수신하고 민감정보 없는 제한된 진단을 남긴다.

**Architecture:** 현재 두 풀 생성 지점에 각각 작은 수신 함수를 둔다. 연결 정책, Drizzle 반환형, Nest DI, replay 실패 차단과 종료 소유권은 유지한다.

**Tech Stack:** TypeScript, node-postgres 8.22.0, Drizzle, NestJS, Vitest, Node 22.15.1, pnpm 11.9.0.

**Spec:** [사용자 승인 A안](../../status/2026-09-09-next-work-review.ko.md). 2026-09-09 사용자가 “오케이”로 승인했다.

## Global Constraints

- 제품 코드 2개·테스트 2개만 변경한다. 의존성, lockfile, DB 스키마, 풀 한도, 인증 정책, 자동 재시도는 변경하지 않는다.
- 고정 진단 문자열은 `DB_POOL_IDLE_ERROR source=bff`, `DB_POOL_IDLE_ERROR source=api`다. console.error로 풀 인스턴스마다 최초 한 번만 출력한다.
- 오류 이벤트의 error/client 인수를 읽거나 직렬화하지 않는다. 원문·stack·SQL·URL을 출력하지 않는다.
- 진단 출력 함수 자체가 동기적으로 실패해도 풀 오류 수신 함수에서 다시 예외를 전파하지 않는다. 출력 실패를 재시도하거나 다른 채널로 원문을 전송하지 않는다.
- 첫 출력 전에 플래그를 설정한다. 중첩 이벤트에도 출력은 1회이며 타이머·전역 상태·전역 예외 수신은 만들지 않는다.
- 한국어 주석으로 함수 역할·원리와 인수를 사용하지 않는 이유를 설명한다.
- 기존 linked worktree와 `feature/vercel-region-policy`를 그대로 사용한다. 리전 이전·`.gitignore` 등 기존 변경을 보존하고 stage/commit/push/PR/merge/deploy는 하지 않는다.

## Task 1: 양쪽 풀 오류 경계 구현과 테스트

**Files:**
- Modify: `packages/database/src/client.ts`
- Modify: `apps/api/src/me/me.module.ts`
- Create: `packages/database/src/client.test.ts`
- Modify: `apps/api/src/me/me.controller.test.ts`

**Interfaces:** `createDatabaseClient(connectionString: string)`의 기존 반환형과 `API_DATABASE_POOL`의 Pool 타입을 유지한다. 새 공개 API는 없다.

- [x] RED: 실제 lazy pg.Pool에서 error 이벤트를 발생시켜 예외 전파·진단 비밀값 노출·반복 출력 계약을 검사한다. API는 기존 mock 생성자가 실제 lazy Pool을 반환하도록 바꿔 Nest의 실제 factory를 거친 인스턴스를 검사한다. 네트워크 연결은 하지 않는다.

테스트 핵심(실제 파일의 fixture·cleanup 안에 배치):

```ts
const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
const database = createDatabaseClient("postgresql://test:fake-secret@localhost/test");
try {
  expect(() => database.$client.emit("error", new Error("fake-secret SQL detail"), { password: "fake-secret" })).not.toThrow();
  expect(() => database.$client.emit("error", new Error("second-secret"))).not.toThrow();
  expect(diagnostic.mock.calls).toEqual([["DB_POOL_IDLE_ERROR source=bff"]]);
} finally {
  await database.$client.end();
  diagnostic.mockRestore();
}
```

추가로 새 풀은 다시 최초 진단을 내는지, console.error가 throw해도 이벤트가 전파되지 않는지 검사한다. API는 같은 계약을 `source=api`로 검사하고 기존 풀 생성 옵션·종료 1회 테스트를 유지한다. 환경변수·spy·pool은 실패 시에도 finally에서 정리한다. 기존 테스트의 mock-only 의존 때문에 실제 이벤트 동작이 사라지지 않게 한다.

- [x] 다음 명령으로 RED를 관찰하고 원인을 보고서에 기록한다.

```powershell
$env:PATH = "$env:TEMP\codex-node-v22.15.1-win-x64;$env:PATH"
pnpm --filter @account-book/database exec vitest run src/client.test.ts
pnpm --filter @account-book/api exec vitest run src/me/me.controller.test.ts
```

- [x] GREEN: Drizzle 반환값 `$client`와 API의 생성된 Pool에 다음 패턴을 연결한다. BFF는 database, API는 pool을 그대로 반환한다.

```ts
let reportedIdleError = false;
pool.on("error", () => {
  if (reportedIdleError) return;
  reportedIdleError = true;
  try {
    console.error("DB_POOL_IDLE_ERROR source=api");
  } catch {
    // 진단 출력 실패가 DB 이벤트를 다시 처리되지 않은 예외로 만들지 않게 한다.
  }
});
```

BFF는 `const database = drizzle({ connection: connectionString, schema });` 후 `database.$client.on`에 같은 패턴을 적용하고 source를 bff로 고정한다. 오류를 수신하는 것과 DB 복구 성공은 별개다. pg가 연결을 제거하는 기존 동작에 개입하지 않는다.

- [x] focused GREEN: database 전체 테스트 + API controller/replay-store 테스트. 타입 검사와 전체 verify는 controller가 실행한다.
- [x] Self-review: 원문 로그·자동 재시도·풀 설정 변경·전역 상태·불필요한 export가 없는지 확인한다.
- [x] Controller: 독립 task review 후 전체 verify, 문서 갱신, 최종 변경 검토. 커밋하지 않는다.

## 문서 및 검증 마무리 (controller)

- [x] `docs/architecture/backend-authentication.ko.md`: query 오류와 idle 이벤트 차이, 1회 진단의 한계, 변경 없는 종료/복구 책임 설명.
- [x] `docs/guides/security-auth-testing.md`: baseline/RED/GREEN/전체 verify 결과와 실제 DB 장애 실험 미실행 기록.
- [x] `docs/status/2026-08-24-development-progress.ko.md`: 완료·미커밋·남은 인증 요청 시간 제한 작업 기록.
- [x] `pnpm verify` 실행, 종료 코드·테스트 수 기록. 브라우저/FCP, 실 DB 네트워크 장애, CI·배포는 이번 실행 대상이 아니다.

## 실행 기록

- 2026-09-10 후속: 사용자 로컬 커밋 승인. 현재 작업 트리의 `pnpm verify`를 재실행해 878 tests·lint·타입·build 종료 코드 0을 확인했다. `output/precommit-20260910-verify.log`에 결과를 보관한다. 리전 전용 변경은 `92e54e2`로 먼저 커밋했으며 DB 변경과 공통 문서를 다음 커밋으로 구분한다. 아래 미커밋 표현은 9월 9일 실행 당시 기록이다. 푸시·PR·병합·배포는 승인 범위가 아니다.

- 구현·task review·최종 문서/통합 리뷰 완료. 제품 2파일 각각 +13/-1, API 테스트 +105/-33, DB 신규 테스트 56줄이다. 결과 문서 3개 외 사전 검토 문서의 상태 1줄도 갱신했다.
- RED: DB 3개 실패, API 테스트 대역 생성자 수정 후 2개 실패/7개 통과. 모두 실제 lazy Pool의 미처리 error 이벤트로 예상 실패했다.
- GREEN: database 15/15, API controller/replay-store 24/24. 반복·중첩·풀별 진단과 진단 출력 실패를 검증했다.
- 전체 `pnpm verify` 종료 코드 0: 878 tests(54+66+15+148+510+85), lint·6 workspace 타입 검사·API/웹 build 통과. 원시 출력은 Git 제외 `output/database-pool-error-verify.log`.
- 독립 task review: spec compliant / quality Approved, Critical·Important 없음. 최종 통합 리뷰도 Critical·Important 없이 로컬 완료 가능으로 판단했다.
- 잔여 Minor: API 테스트의 finally에서 module.close 자체가 reject하면 뒤의 spy/env 복구가 생략될 수 있다. 현재 테스트는 연결을 열지 않는 실제 lazy Pool을 쓰므로 재현된 실패는 아니며 후속 테스트 정리로 남겼다. DB 테스트에는 별도 afterEach의 spy 복원이 있어 같은 수준으로 일반화하지 않는다.
- 실제 DB 재시작·네트워크 단절·브라우저/FCP·DB-backed E2E·audit 재실행·hosted 인증·CI·배포는 미실행. 커밋·푸시·PR·병합 없음.

- 기준 검사: database 12/12, API controller/replay-store 23/23 통과. 결합 명령 말미의 bash 탐색은 찾지 못해 shell 종료 코드가 1이었지만 두 테스트 명령은 각각 성공했다.
- Git: 리전 작업과 파일이 겹치는 결과 문서는 기존 내용에 추가만 한다. 구현 4개 파일은 리전 변경 대상과 겹치지 않는다.
