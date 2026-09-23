# 인증 보안 분기 커버리지 보완 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 웹 인증 보안 대상의 분기 커버리지를 92.48%에서 설정된 100%까지 보완하고, 동일 검사를 CI에서 실행한 뒤 승인된 PR 병합 절차를 재개한다.

**Architecture:** 기존 서비스·어댑터·저장소를 실제로 실행하되 외부 HTTP/DB 경계만 통제한다. 제품 동작·DB 스키마·의존성은 바꾸지 않고, 테스트 대상 제외나 임계값 하향으로 수치를 맞추지 않는다. 실제 결함이 발견되면 실패 재현을 먼저 남기고 별도 수정 범위를 보고한다.

**Tech Stack:** Node 22.15.1, pnpm 11.9.0, TypeScript, Vitest 4.1.11/V8 coverage, GitHub Actions.

**Spec:** 사용자 2026-09-23 승인(테스트 보완 후 PR #12 → PR #13 순서 재개), `docs/superpowers/specs/2026-09-14-auth-provider-deadline-design.md`, `apps/web/vitest.config.ts`.

## Global Constraints

- `branches: 100` 유지. 기존 coverage include/exclude 및 보안 정책을 완화하지 않는다.
- 제공자 작업당 총 5,000ms, 원문 자격증명·오류 비공개, 토큰 소유자 검사 유지.
- 실제 금융결제원·Supabase 계정·실계좌·운영 DB에 접속하지 않는다.
- 실제 비밀값 없이 `.test` 도메인과 테스트 실행 중 생성한 난수만 사용한다.
- 기존 `.gitignore` 사용자 변경 및 다른 worktree는 수정·스테이징하지 않는다.
- 새 테스트 보조 함수에는 한국어 역할·매개변수·반환 설명을 넣는다.
- PR #13 병합, 다른 PR 닫기, 배포는 이번 승인 범위가 아니다.

## 현재 증거와 작업 규모

- PR #12: head `8dcb85b`, Draft, 209개 파일의 누적 변경. 보안 패치만 있는 PR이 아니다.
- 현재 격리 worktree: `feature/bank-connection-foundation`, head `7491903`. PR #12 head와 `apps/web` 코드 차이는 없다.
- 직전 재검증: 32개 테스트 파일/569개 테스트 통과. 분기 763/825(92.48%), 미실행 62개, 종료 코드 1.
- 현재 작업에서 coverage JSON을 다시 대조한 분포:

| 구현 파일 | 미실행 분기 | 주요 보완 내용 |
| --- | ---: | --- |
| auth/email-auth-service.ts | 14 | callback·시각·식별자·인증 레코드·오류 경계 |
| auth/fake-auth-provider.ts | 6 | bridge 응답·기본 fetch·필수 결과 누락 |
| auth/supabase-auth-adapter.ts | 3 | 가입·복구·비밀번호 입력 거부 |
| auth/supabase/error-mapper.ts | 4 | 비객체·code 누락·SDK 상태 누락·복구 오류 |
| auth/supabase/http-client.ts | 2 | 성공/실패 응답의 JSON 파싱 실패 |
| auth/supabase/provider-operation.ts | 1 | Request 객체의 취소 신호 |
| auth/supabase/session-parser.ts | 3 | accepted 응답 오류·비정규 JWT 구간 |
| auth/supabase/validation.ts | 1 | 파싱할 수 없는 URL |
| persistence/postgres-auth-repository.ts | 26 | 잘못된 행·소비 시각·경합·복구 상태 잠금 |
| session/session-service.ts | 2 | 원시 제공자 오류·기본 시계 |

추정: 테스트·설정·문서 합계 14~17개 파일, 테스트 약 450~750줄 추가. 이는 계획 추정이며 최종 diff로 교정한다. 62개 분기는 테스트 62개와 같지 않다. 표 기반 사례 하나가 여러 분기를 검증할 수 있다.

기존 테스트의 비어 있지 않은 줄 수: email 229, fake 69, adapter 118, error-mapper 68, provider-operation 215, session-parser 108, postgres repository 389, session service 522. 큰 DB 파일은 아래와 같이 fixture/거래 테스트를 분리해 계속 커지지 않게 한다. 세션 파일은 2개 경계만 추가하며 전체 리팩터링하지 않는다.

## Review Focus

1. 잘못된 DB 행을 정상 인증 상태로 수용하지 않는가? Task 3에서 반환 null/false와 후속 쓰기 중단을 검사한다.
2. 제공자 원시 오류가 사용자에게 노출되지 않는가? Task 1/2에서 고정 코드 및 원문 부재를 확인한다.
3. 만료·시계 기본값에서 잘못된 세션을 만들지 않는가? Task 2에서 fake clock과 날짜 경계를 검사한다.
4. 호출자가 Request 신호로 취소했을 때 늦은 응답을 수용하지 않는가? Task 1에서 AbortController를 직접 중단한다.
5. 테스트를 통과했어도 미검증 분기가 생겼을 때 CI가 놓치지 않는가? Task 4에서 독립 coverage 실행을 필수 단계로 추가한다.

## Task 1 — 제공자 전송·오류·파서 경계 (11개 분기)

**Files:**
- Create: `apps/web/src/server/auth/supabase/http-client.test.ts`
- Create: `apps/web/src/server/auth/supabase/validation.test.ts`
- Modify: `apps/web/src/server/auth/supabase/error-mapper.test.ts`
- Modify: `apps/web/src/server/auth/supabase/provider-operation.test.ts`
- Modify: `apps/web/src/server/auth/supabase/session-parser.test.ts`

**Interfaces:** `requestSupabaseAuth(config, fetcher, url, body)`, `safeUrl(value, allowDevelopmentHttp)`, `mappedProviderError(value, status?, pkce?)`, `runProviderOperation(fetcher, work)`, `accepted(value)`, `tokenPair(value)`를 기존 export 그대로 호출한다.

- [ ] 기준 coverage 명령을 실행해 종료 코드 1과 분기 목록을 저장한다. 이미 존재하는 동작의 보완 테스트는 처음부터 통과할 수 있다. 이를 새 기능의 RED라고 부르지 않는다.
- [ ] 새 HTTP 테스트에 다음 독립 기대값을 사용한다. 이 테스트는 성공 JSON 파싱 실패를 허용하거나 실패 상태를 잃으면 깨져야 한다.

```typescript
import { expect, it, vi } from "vitest";
import { requestSupabaseAuth } from "./http-client.js";
vi.mock("server-only", () => ({}));

it.each([200, 503])("handles malformed JSON with status %s", async (status) => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response("not-json", { status }));
  const pending = requestSupabaseAuth(
    { url: "https://provider.example.test/", anonKey: "test-only-key" },
    fetcher, new URL("https://provider.example.test/auth/v1/token"), { code: "test-code" },
  );
  if (status === 200) await expect(pending).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  else await expect(pending).resolves.toEqual({ ok: false, status: 503, body: null });
});
```

- [ ] `safeUrl("not-a-url", false)`가 `AUTH_PROVIDER_UNAVAILABLE`로 거부되는 사례를 추가한다.
- [ ] `providerCode`에 null/배열/문자열/숫자 code를 넣어 빈 코드로 처리되는지 검사한다. `mappedProviderError({code:"same_password"})`는 `AUTH_OAUTH_TRANSACTION_INVALID`; 상태·code 없는 객체는 `AUTH_PROVIDER_UNAVAILABLE`이다.
- [ ] `accepted({error:{status:429}})`가 rate-limit 오류인지, `accepted({})`가 오류 없이 끝나는지 검사한다. JWT 헤더/서명 구간 `"A"`(빈 디코드)와 `"Zh"`(비정규 재인코딩)를 정상 session fixture에 각각 넣고 고정 오류로 거부한다.
- [ ] `Request`에 controller.signal을 넣고 init 인자를 생략해 `operation.fetch(request)`를 호출한다. fetch 대기 중 controller.abort()를 호출하고 고정 오류·내부 전송 취소·타이머 정리를 확인한다. 원래 Request/controller를 구현이 임의로 변경하지 않아야 한다.
- [ ] `pnpm --filter @account-book/web exec vitest run src/server/auth/supabase` 실행 후 coverage 재측정. 변경한 기대값과 실제 오류·부수효과를 대조하고 커밋한다.

## Task 2 — 인증 서비스·어댑터·세션 경계 (25개 분기)

**Files:**
- Modify: `apps/web/src/server/auth/email-auth-service.test.ts`
- Modify: `apps/web/src/server/auth/fake-auth-provider.test.ts`
- Modify: `apps/web/src/server/auth/supabase-auth-adapter.test.ts`
- Modify: `apps/web/src/server/session/session-service.test.ts`

**Interfaces:** 기존 `setup()`/`subject()` 및 생성자 주입점을 사용한다. production private 함수를 export하거나 테스트 전용 메서드를 제품 클래스에 넣지 않는다.

- [ ] email 테스트의 기존 setup/validInput을 사용해 callback 거부를 고정한다.

```typescript
it.each([
  new URL("https://user:password@app.example.test/auth/confirm"),
  new URL("https://app.example.test/auth/confirm#fragment"),
  new URL("http://remote.example.test/auth/confirm"),
])("rejects unsafe callbacks before sending credentials", async (emailRedirectUrl) => {
  const subject = setup();
  await expect(subject.service.signUp(validInput, { ...subject.context, emailRedirectUrl }))
    .rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  expect(subject.repository.events).toEqual([]);
});
```

- [ ] URL 대신 문자열을 넘기는 비정상 런타임 입력, 잘못된 Date, 잘못된 interaction selector, 잘못된 생성 UUID, 최대 Date+15분 오버플로를 각 생성자/공개 메서드에서 검증한다. 정상 localhost HTTP도 허용되는 경로를 확인한다.
- [ ] 가입·로그인의 잘못된 입력은 `AUTH_INVALID_CREDENTIALS`; 메일 확인의 없는 transaction/다른 interactionHash/잘못된 consumedAt/15분이 아닌 수명은 `AUTH_OAUTH_TRANSACTION_INVALID`인지 확인한다. 세션 생성이 없어야 한다.
- [ ] 가입의 `AUTH_EMAIL_VERIFICATION_REQUIRED`도 `{accepted:true}`로 계정 존재를 숨기는지 검사한다. 알 수 없는 하위 오류는 원문을 노출하지 않아야 한다.
- [ ] 가짜 제공자의 필수 result null, bridge의 401·누락 Content-Type·잘못된 JSON/사용자·만료 토큰을 검사한다. 기본 fetch 경로는 `vi.stubGlobal("fetch", controlledFetcher)`로 제한하고 반드시 restore한다. 실제 네트워크는 사용하지 않는다.
- [ ] Supabase adapter의 잘못된 가입 이메일, 복구 이메일, 짧은 새 비밀번호를 넣어 provider 호출 전에 고정 오류가 나는지 검사한다.
- [ ] SessionService refresher가 null/문자열을 throw하면 unavailable로 정규화되는지 검사한다. 생성자 clock을 생략하고 fake system time에서 refresh를 실행해 완료 시각 기반 만료 처리를 검사한다.
- [ ] 기본 시계 및 기본 ID 생성 경로는 실제 전역 시간을 고정해 재현하고 테스트 후 복원한다. default 경로만 밟고 결과를 검사하지 않는 테스트는 쓰지 않는다.
- [ ] 해당 테스트 파일들을 실행하고 coverage 재측정 후 커밋한다. 발견한 제품 결함은 재현 테스트를 먼저 남기고 별도 범위를 보고한다.

## Task 3 — DB 결과·복구 트랜잭션 경계 (26개 분기)

**Files:**
- Modify: `apps/web/src/server/persistence/postgres-auth-repository.test.ts`
- Create: `apps/web/src/server/persistence/postgres-auth-repository.test-fixtures.ts`
- Create: `apps/web/src/server/persistence/postgres-auth-transactions.test.ts`

**Interfaces:** 기존 FakeDatabase/subject/query 및 session fixture를 테스트 전용 파일로 이동한다. 동일 이름과 호출 계약을 유지한다. 기존 파일은 세션 저장·회전 테스트를 유지하고 OAuth/email/recovery 테스트를 새 거래 테스트 파일로 옮긴다. `*.test-fixtures.ts`는 제품 import가 없어야 한다.

- [ ] 기존 테스트를 변경 없이 실행해 기준 결과를 기록한다.
- [ ] fixture와 거래 테스트를 기계적으로 분리한 후 동일 테스트 수와 통과를 확인한다. 테스트 추가는 분리 검증 후에 진행한다.
- [ ] 잘못된 DB 값 null/배열/문자열, 유효한 행이 0개 또는 2개인 결과를 각각 주입하고 null 반환을 확인한다.
- [ ] 생성 함수의 consumedAt null/Date 저장값과 복사 여부를 검사한다. DB 소비 결과의 consumedAt null/Date 양쪽도 실제 매핑 결과로 검증한다.
- [ ] 유효하지 않은 digest/now/transactionId/userId/expected claim 시각을 claim·promote·consume에 넣는다. 결과 null/false와 SQL 쓰기가 없음을 함께 검사한다.
- [ ] 복구 상태의 시간 순서를 표로 검사한다: 소비가 password claim보다 이른 값, 만료 시각과 같은 값, 단계별 날짜 대신 문자열, 비밀번호 claim 없이 소비된 상태. 각 case는 null이어야 한다. 정상 소비 상태의 모든 날짜 복사도 확인한다.
- [ ] 다음 실패 경로는 사용자 보안 상태 잠금 누락 시 세션 폐기를 진행하면 깨지는 테스트다. 기존 subject/상수를 이동한 fixture에서 import한다.

```typescript
it("stops session revocation if the user security gate cannot be locked", async () => {
  const { database, repository } = subject();
  database.affectedRows = [{}];
  database.securityRows = [];
  await expect(repository.consumeRecoveryAndRevokeSessions({
    transactionId: id, userId, expectedPasswordUpdateClaimedAt: now, now,
  })).rejects.toThrow("AUTH_USER_SECURITY_STATE_LOCK_FAILED");
  expect(database.calls.some((call) => call.table === "auth_sessions")).toBe(false);
});
```

- [ ] consume 결과 0행/2행이면 false이며 user security state/session 쓰기가 없어야 한다.
- [ ] 단위 대역은 실제 롤백·동시성을 보장하지 않음을 기록한다. 별도 disposable PostgreSQL 통합 테스트는 최종 CI에서 실행한다.
- [ ] 두 repository 테스트 파일 실행 및 coverage 100% 확인 후 커밋한다. 도달 불가능 분기가 남으면 증거와 원인을 보고하고 기준 제외/제품 변경으로 임의 우회하지 않는다.

## Task 4 — CI 재발 방지·문서·전체 검증

**Files:**
- Modify: `.github/workflows/security-gate.yml`
- Create: `docs/status/2026-09-23-auth-coverage-completion.ko.md`
- Update: 이 계획의 체크리스트, Notion 10-A 진행 기록.

**Interfaces:** 기존 `@account-book/web test:coverage` 스크립트를 그대로 소비한다. 새 의존성이나 root verify 중복 실행은 추가하지 않는다.

- [ ] repository verification 다음에 아래 step을 추가한다. `continue-on-error`나 이벤트별 생략 조건을 넣지 않는다.

```yaml
      - name: Enforce authentication branch coverage
        run: pnpm --filter @account-book/web test:coverage
```

- [ ] `pnpm --filter @account-book/web test:coverage`: exit 0, 대상 분기 100%.
- [ ] `pnpm verify`: lint/typecheck/전체 테스트/빌드 모두 exit 0. 기존 실패도 숨기지 않는다.
- [ ] `git diff --check`와 변경 파일 목록 확인. 사용자 .gitignore와 생성 coverage 결과가 커밋에 없는지 검사한다.
- [ ] 실제 결함을 수정했다면 RED→GREEN 및 현실적인 변경으로 테스트가 깨지는 이유를 기록한다. 기존 동작 보완에는 baseline coverage RED→coverage GREEN과 테스트 내용 검토를 구별해 기록한다.
- [ ] 한국어 보고서에 파일 수/추가·삭제 줄 수/테스트 수/분기 수/실행 명령/종료 코드/미실행 항목을 적는다. 100% coverage가 취약점 부재나 실서비스 안전성 보증은 아니라고 설명한다.

## PR 반영 순서

1. 테스트 보완은 PR #12 소스인 `feature/auth-provider-deadline`에 반영한다. 현재 A1 브랜치에만 추가하면 PR #12의 품질 문제가 해결되지 않는다.
2. 실행 직전 원격 SHA와 worktree 점유를 다시 확인하고, 사용자 변경을 보존한 채 기존 worktree에서 선행 브랜치로 전환한다. 현재 생성한 이 계획은 함께 유지한다. 강제 reset/force-push는 하지 않는다.
3. 순차 구현 또는 작업별 독립 구현 중 사용자가 고른 방식으로 실행하고 최종 독립 리뷰를 받는다.
4. 보완 커밋을 PR #12에 push하고 새 CI 전체 성공 및 누적 변경 리뷰를 확인한다. PR body의 과거 coverage 실패는 이력으로 보존하고 최신 결과를 추가한다.
5. 검증 완료 후 Draft 해제·최신 head 고정·merge commit으로 PR #12 병합. 브랜치는 삭제하지 않는다.
6. PR #13 대상만 main으로 변경한다. 자동 CI가 실행되지 않으면 현재 base로 새 이벤트를 생성해 재검증한다. 오래된 base 이벤트 재실행을 새 base 검증으로 간주하지 않는다.
7. Dependabot open alerts를 다시 확인한다. 비동기 반영이 늦으면 확인 시각과 잔여 경고를 그대로 보고한다. 경고를 수동 dismiss하지 않는다.

## 자체 점검과 실행 상태

- [x] 미검증 분기의 10개 구현 파일/62개 분포 확인.
- [x] PR #12가 아직 Draft이며 head가 변하지 않았음을 확인.
- [x] 테스트 보완·파일 규모·브랜치 적용·CI 누락을 계획에 포함.
- [x] 기본 coverage 기준을 낮추지 않으며 실제 계정/키가 필요 없음을 확인.
- [ ] 사용자가 상세 계획과 실행 방식 확인.
- [ ] 테스트/CI 구현 및 전체 검증.
- [ ] PR #12 병합 → PR #13 대상 변경 → 경고 재확인.

권장 실행 방식: **현재 세션 순차 구현 + 마지막 독립 리뷰**. 기존 fixture를 공유하는 보완 작업이므로 구현을 순서대로 진행하면 중복 fixture·충돌을 줄인다. 작업별 독립 구현/리뷰 방식도 가능하지만 문맥 전달·검토 비용이 더 든다. 이 문서는 실행 계획이며 구현 완료 보고가 아니다.
