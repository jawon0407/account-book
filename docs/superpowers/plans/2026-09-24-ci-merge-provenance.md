# 정상 PR 병합 증빙 CI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub의 실제 병합 기록과 push 이전/이후 커밋을 대조해 정상 main 병합을 허용하고, 증빙 없는 직접 변경과 확인 불가 상황은 실패시킨다.

**Architecture:** 네트워크 없는 판정기, 제한된 GitHub 조회기, 기존 Git 읽기·CLI 연결을 나눈다. main 전용 증빙 job에서만 PR 읽기 권한을 사용하고 기존 품질 job은 증빙 결과를 확인한 뒤 실행한다. 로컬 main push 금지와 전체 이력 secret scan을 유지한다.

**Tech Stack:** Node 22.15.1 내장 fetch/AbortController/node:test, pnpm 11.9.0, GitHub Actions/REST, 기존 .mjs 보안 도구. 새 의존성 없음.

**Spec:** [승인된 서면 설계](../specs/2026-09-24-ci-merge-provenance-design.md). 사용자 2026-09-24 서면 검토 승인. 본 계획은 아직 실행 승인 전이다.

## Global Constraints

- main 기준 9e2ff81, 현재 feature/ci-merge-provenance의 설계 커밋 6a974de에서 이어간다. 기존 linked worktree를 재사용하고 사용자 .gitignore 변경을 보존한다.
- GitHub API 전체 예산 10초(본문 포함), 응답당 1MiB, 후보 100개/페이지·최대 3페이지. 자동 재시도/redirect 금지. 일부 페이지만으로 허용하지 않는다.
- 실제 병합 여부·정확한 저장소 ID/이름·main·결과 SHA·부모 관계를 모두 확인한다. 메시지/작성자/단순 boolean으로 허용하지 않는다.
- merge commit과 squash 등 단일 결과 커밋 지원. 여러 커밋 rebase, 배치 갱신, merge queue는 지원하지 않는다.
- 증빙 job만 contents:read + pull-requests:read. 자동 github.token은 해당 실행 step에만 전달. PAT/운영 secret/쓰기 권한/pull_request_target 추가 금지.
- pre-push는 main을 계속 거부하고 네트워크를 호출하지 않는다. 기존 feature/hotfix/maintenance/PR 경로·5MiB blob 제한·전체 이력 scan 유지.
- 인증 coverage branches:100 및 기존 대상 범위 유지. UI/인증 런타임/금융 DB/의존성 변경 없음.
- 신규 함수에는 한국어 역할·매개변수·반환·실패 조건 주석을 단다. 테스트는 합성 이벤트, 폐기용 Git, 현재 checkout의 읽기 전용 검사만 사용하며 실계좌·운영 금융 API 호출은 없다.
- 커밋은 작업별로 파일을 지정해 수행한다. push/PR/병합/배포는 본 구현 계획 승인과 별개로 사용자 승인 범위에서만 수행한다. PR #13은 건드리지 않는다.

## 파일 지도와 규모

기존 14~16파일 추정에서 **19파일**로 구체화했다. 공통 fixture 1개, Git 부모 검증 모듈/독립 테스트 2개를 추가한 이유는 HTTP 파일이나 495줄 workflow 테스트에 서로 다른 책임을 몰지 않기 위해서다. 아래 줄 수는 구현 후 목표/증가 예상이며 강제 한도가 아니다. 초과 시 실제 diff와 이유를 보고한다.

| 파일 | 작업·책임 | 예상 크기/증가 |
| --- | --- | --- |
| scripts/security/merge-evidence.mjs | 신규, 이벤트·증빙·job 결과 순수 판정 | 150~220줄 |
| scripts/security/merge-evidence.test.mjs | 신규, 허용/거부 조건 | 180~280줄 |
| scripts/security/merge-evidence.test-fixtures.mjs | 신규, 합성 event/context/PR 생성 | 55~85줄 |
| scripts/security/github-merge-evidence.mjs | 신규, bounded HTTP·페이지·상세 조회 | 130~200줄 |
| scripts/security/github-merge-evidence.test.mjs | 신규, transport·한도·비노출 | 200~300줄 |
| scripts/security/git-change-reader.mjs | 수정, HEAD/부모 읽기 재사용 | +25~45줄 |
| scripts/security/git-merge-context.test.mjs | 신규, 실제 임시 Git 검증 | 90~150줄 |
| scripts/security-gate.mjs | 수정, CI main 증빙 연결·토큰 수명 | +35~65줄 |
| scripts/security-gate.test.mjs | 수정, 실제 CLI 회귀·안전한 실패 | +40~75줄 |
| scripts/security/gate.mjs | 수정, 증빙 전달 | +5~15줄 |
| scripts/security/gate.test.mjs | 수정, 범위/실행 순서 | +35~65줄 |
| scripts/security/push-policy.mjs | 수정, main 증빙 판정 호출 | +10~20줄 |
| scripts/security/push-policy.test.mjs | 수정, 기존 경로 유지 | +25~50줄 |
| .github/workflows/security-gate.yml | 수정, 격리 job·결과 검사 | +45~75줄 |
| scripts/security/workflow-policy.test.mjs | 수정, job별 권한/실행 계약·digest | +70~120줄 |
| docs/security/free-plan-compensating-controls.md | 수정, 지원 방식·권한·실패 대응 | +35~60줄 |
| docs/status/2026-09-24-ci-merge-provenance.ko.md | 신규, 실제 검증/제약 기록 | 50~90줄 |
| docs/superpowers/specs/2026-09-24-ci-merge-provenance-design.md | 승인 상태·범위 기록 | 문서 |
| docs/superpowers/plans/2026-09-24-ci-merge-provenance.md | 이 계획·실행 체크 | 문서 |

구현·테스트 약 1,200~1,900줄을 예상한다(문서 제외). 보안 기능은 작지만 실패·권한 경계 테스트 비중이 크다. 위 파일 외 수정이 필요하면 범위와 이유를 먼저 기록한다.

## 공통 계약과 오류

`MainPushContext = {repository:string, repositoryId:number, before:string, after:string}`. repository는 검증한 owner/repo, ID는 양의 안전한 정수, SHA는 소문자 정규화한 40자리 비영값이다. before와 after는 달라야 한다.

`MergeEvidence = {context:MainPushContext, candidate:object, pullRequest:object, commit:{head:string, parents:string[]}}`. candidate는 목록에서 선택한 PR, pullRequest는 상세 응답이다. 외부 필드는 항상 재검사하며 생성자/객체 존재만으로 증빙이 되지 않는다. 토큰은 이 객체에 포함하지 않는다.

| 코드 | 고정 메시지 | 의미 |
| --- | --- | --- |
| MAIN_PUSH_CONTEXT_INVALID | Main push context is invalid. | 이벤트/컨텍스트/CLI 불일치 |
| MAIN_MERGE_EVIDENCE_REJECTED | Main update is not linked to one supported merged pull request. | 정상 조회 결과이지만 정책 불일치 |
| MAIN_MERGE_EVIDENCE_UNAVAILABLE | GitHub merge evidence could not be verified. | 토큰/HTTP/JSON/한도/필수 응답 형태 문제 |
| MAIN_PROVENANCE_JOB_FAILED | Main provenance job did not complete successfully. | main job 결과 실패/취소/누락/skipped |

기존 GIT_READ_FAILED, SHALLOW_REPOSITORY_UNSUPPORTED, DIRECT_MAIN_PUSH, 기타 non-main 오류는 유지한다. `SecurityGateError` 클래스는 수정하지 않는다. 필수 응답 필드가 없거나 타입이 틀리면 unavailable, 타입이 정상인데 값이 다른 경우 rejected로 구분한다.

## Review Focus

1. 늦게 도착한 예전 이벤트·재실행: 현재 원격 main이 아니라 이벤트 before/after로 판정한다(Task 1/3).
2. 후보가 첫 페이지에 있어도 다음 페이지에 중복 또는 충돌 후보가 있을 수 있다. 전체 제한된 페이지 완료 전 허용하지 않는다(Task 2).
3. 본문 스트림이 계속 이어지거나 fetch가 취소를 무시해도 10초 후 실패하고 늦은 오류를 처리한다(Task 2).
4. 목록과 상세 조회 사이 PR 정보가 달라지거나 미병합 시험 SHA가 일치할 수 있다. identity·상태·SHA 교차 검사를 한다(Task 1/2).
5. needs 작업의 실패/취소/skipped 및 자식 프로세스 토큰 상속: 성공처럼 보이거나 조회 토큰이 테스트에 전달되지 않아야 한다(Task 3/4).

## Task 1 — 순수 입력·증빙 판정

**Files:** 신규 merge-evidence.mjs, merge-evidence.test.mjs, merge-evidence.test-fixtures.mjs.

**Interfaces:**
- `normalizeMainPushContext({event, env, options}) => MainPushContext`: 파일/네트워크 없이 이벤트와 GITHUB_ACTIONS/GITHUB_EVENT_NAME/GITHUB_REF/GITHUB_SHA/GITHUB_REPOSITORY/GITHUB_REPOSITORY_ID 및 기존 CLI eventName/targetRef/base/head를 대조한다.
- `assertMainMergeEvidence({base, head, evidence}) => {prNumber:number, sha:string}`: 전체 증빙을 검증한 후 비밀값 없는 요약 반환.
- `assertProvenanceJobResult({eventName, targetRef, result}) => void`: push/main은 success만, 그 외 기존 지원 이벤트는 skipped만 허용. 알 수 없는 이벤트/결과 거부.
- `withoutGithubCredentials(env) => Record<string,string|undefined>`: 원본을 바꾸지 않고 GITHUB_TOKEN/GH_TOKEN(대소문자 무시)을 제거한 복사본. 자식 프로세스에 사용한다.
- fixture의 `mainFixture() => {event, env, options, context, candidate, pullRequest, commit}`는 호출마다 독립 객체를 반환한다. production에서 import하지 않는다.

- [ ] 합성 fixture를 작성한다. 아래 값에 candidate의 number=12, id=120, state=closed, draft=false, merged_at="2026-09-23T07:30:53Z", merge_commit_sha=after, base={ref:"main",repo:{id:7,full_name:repository}}, head={sha:source}를 넣는다. pullRequest는 같은 필드에 merged:true를 추가한다. 이벤트 repository={id:7,full_name:repository}, ref=refs/heads/main, forced/created/deleted=false다.

```js
export function mainFixture() {
  const before="1".repeat(40), after="2".repeat(40), source="3".repeat(40);
  const repository="example/account-book";
  const context={repository,repositoryId:7,before,after};
  const candidate={id:120,number:12,state:"closed",draft:false,
    merged_at:"2026-09-23T07:30:53Z",merge_commit_sha:after,
    base:{ref:"main",repo:{id:7,full_name:repository}},head:{sha:source}};
  return {context,candidate,pullRequest:{...structuredClone(candidate),merged:true},
    commit:{head:after,parents:[before,source]},
    event:{repository:{id:7,full_name:repository},ref:"refs/heads/main",before,after,
      forced:false,created:false,deleted:false},
    env:{GITHUB_ACTIONS:"true",GITHUB_EVENT_NAME:"push",GITHUB_REF:"refs/heads/main",
      GITHUB_SHA:after,GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_ID:"7"},
    options:{mode:"ci",eventName:"push",targetRef:"refs/heads/main",base:before,head:after}};
}
```

- [ ] 먼저 아래 공개 결과 테스트를 작성한다. 구현 파일/함수가 없어 발생하는 첫 실패를 기록한 뒤 최소 export를 만들고 조건별 실패를 순차 구현한다.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { assertMainMergeEvidence } from "./merge-evidence.mjs";
import { mainFixture } from "./merge-evidence.test-fixtures.mjs";
test("accepts only a matching real merged PR", () => {
  const f = mainFixture();
  assert.deepEqual(assertMainMergeEvidence({base:f.context.before, head:f.context.after,
    evidence:{context:f.context,candidate:f.candidate,pullRequest:f.pullRequest,commit:f.commit}}),
    {prNumber:12,sha:f.context.after});
  f.pullRequest.merged = false;
  assert.throws(() => assertMainMergeEvidence({base:f.context.before,head:f.context.after,
    evidence:{context:f.context,candidate:f.candidate,pullRequest:f.pullRequest,commit:f.commit}}),
    {code:"MAIN_MERGE_EVIDENCE_REJECTED"});
});
```

Run: `node --test scripts/security/merge-evidence.test.mjs`. Expected: RED(미구현 또는 조건 판정 실패) → 구현 후 GREEN.

- [ ] 컨텍스트 검증은 일반 객체·필수 문자열/boolean/안전한 정수·SHA부터 검사한다. repo 각 구간은 비어 있지 않은 ASCII 영숫자/하이픈/밑줄/점만 허용하고 점 하나/점 두 개는 거부한다. repository는 대소문자 무시 비교, ID 문자열은 양의 십진수 정규형으로 변환한다. env와 event의 이름/ID가 모두 같아야 한다. GITHUB_ACTIONS는 정확히 "true", forced/created/deleted는 정확히 false여야 한다.

```js
// 판정의 순서: 구조/타입 → 상태/identity → SHA/부모.
// 순수 구현에서 안전한 메시지는 위 표의 리터럴만 사용한다.
const parents = evidence.commit.parents;
const linked = parents[0] === base && (parents.length === 1 ||
  (parents.length === 2 && parents[1] === evidence.pullRequest.head.sha));
if (!linked) throw new SecurityGateError("MAIN_MERGE_EVIDENCE_REJECTED",
  "Main update is not linked to one supported merged pull request.");
```

- [ ] 다음 표의 변형을 매번 새 fixture에 적용하는 테스트를 추가한다. 모든 rejected/unavailable 사례에서 성공 요약을 반환하지 않는지 확인한다.

| 입력 변형 | 기대 |
| --- | --- |
| 부모 [before] | 단일 결과 성공 |
| 부모 [], 3개, 첫 부모 다름, 두 번째 부모 다름, commit.head 다름 | rejected |
| merged=false, state=open, draft=true, merged_at=null | rejected |
| merged 필드 누락/문자열, malformed 날짜, 객체 대신 배열 | unavailable |
| candidate/detail의 id·number·merge SHA·repo ID/이름·base ref·head SHA 불일치 | rejected |
| 다른 CLI base/head, 잘못된 context SHA/ID | normalize 단계 context-invalid, 증빙 단계의 정상 형식 값 불일치는 rejected |
| event/환경/CLI 어느 한쪽 ref·SHA·ID 불일치, zero/equal SHA, true/누락 flags | context-invalid |
| PR의 base.sha가 after보다 나중인 값이나 없는 값 | before 부모가 맞으면 성공(base.sha 미사용) |
| 임의 메시지/작성자/추가 GitHub 필드 | 판정에 영향 없음 |

- [ ] job 결과는 main의 success만 허용하고 failure/cancelled/skipped/undefined/빈 문자열을 거부하는 표 기반 테스트를 넣는다. 지원된 non-main push/PR은 skipped만 허용하고 success도 거부해 잘못 실행된 증빙 job을 감지한다. 알 수 없는 이벤트/브랜치는 기존 정책과 동일하게 거부한다.
- [ ] `withoutGithubCredentials({PATH:"safe",GITHUB_TOKEN:"canary",gh_token:"canary"})`가 `{PATH:"safe"}`를 반환하고 원본 객체는 보존되는지 검사한다. API용 토큰은 CLI에서 지역 변수로 읽어 조회기에 전달하고 모든 Git/구조 검사 spawn 환경은 이 함수의 결과를 사용한다. 토큰을 증빙 객체·파일·로그에 보존하지 않는다.
- [ ] 집중 테스트와 `pnpm lint`를 실행한다. Expected: exit 0. fixture 외 새 제품 함수 역할 주석을 확인하고 세 신규 파일만 커밋한다(`feat(ci): validate main merge evidence`).

## Task 2 — 제한된 GitHub 증빙 조회

**Files:** 신규 github-merge-evidence.mjs 및 .test.mjs. Task 1 fixture 사용.

**Interfaces:** `loadGithubMergeEvidence(context, {token, fetcher=globalThis.fetch, timeoutMs=10000}) => Promise<{candidate, pullRequest}>`. timeoutMs는 테스트를 위한 짧은 값만 허용(양의 안전한 정수, 최대 10000). 토큰은 env에서 직접 읽지 않고 인자로만 받는다. 함수는 Git을 실행하지 않는다. Task 1의 필드 계약에 맞는 raw candidate/detail 객체를 반환하되 토큰/Response를 섞지 않는다.

- [ ] 성공, 비정상 status, 첫 페이지 일치 뒤 두 번째 페이지 중복을 먼저 테스트한다. URL·헤더·redirect·signal은 fetcher에서 실제 인자를 단언한다.

```js
test("loads list and detail without following response URLs", async () => {
  const f=mainFixture(), calls=[];
  const token="synthetic-test-token";
  const result=await loadGithubMergeEvidence(f.context,{token,fetcher:async (url,init)=>{
    calls.push(String(url));
    assert.equal(new URL(url).origin,"https://api.github.com");
    assert.equal(init.redirect,"error");
    assert.equal(init.headers.Authorization,`Bearer ${token}`);
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(calls.length===1 ? [f.candidate] : f.pullRequest);
  }});
  assert.equal(calls.length,2);
  assert.equal(result.pullRequest.number,12);
  assert.match(calls[0],/\/commits\/[a-f0-9]{40}\/pulls\?per_page=100&page=1$/);
  assert.match(calls[1],/\/pulls\/12$/);
});
```

Run: `node --test scripts/security/github-merge-evidence.test.mjs`. Expected: RED → 구현 후 GREEN.

- [ ] GET 전용·고정 호스트·API version `2026-03-10`·Accept application/vnd.github+json·Authorization Bearer를 사용한다. context 필드를 Task 1 계약으로 재검사하고 URL 각 구간을 encodeURIComponent로 인코딩한다. 응답 url/links는 요청 주소로 사용하지 않는다.
- [ ] 단일 타이머·controller를 조회 전체에 공유한다. 타이머에서 abort만 하지 말고 reject되는 deadline promise와 전체 work를 race해 취소를 무시하는 fetch 대역도 시간 안에 종료한다. pending rejection은 race로 관찰하고 finally에서 타이머를 해제한다. 각 후속 fetch 직전/본문 처리 후에도 signal.aborted를 검사해 늦은 작업의 추가 요청을 차단한다.

```js
// bounded JSON 읽기의 핵심: content-length는 보조이며 실제 바이트를 센다.
const reader=response.body.getReader();
const chunks=[]; let size=0;
try {
  for (;;) {
    const {done,value}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>1024*1024) throw new Error("limit");
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
} finally { reader.releaseLock(); }
// 외부 read/fetch/JSON 오류는 catch에서 unavailable 고정 오류로만 변환.
// 읽기 실패/시간 초과 시 cancel/abort하고 그 promise의 rejection도 관찰.
```

- [ ] 목록을 최대 세 페이지 조회한다. 페이지는 배열·최대 100개여야 한다. Link의 rel=next 존재 여부만 판독하며 모호하거나 잘못된 Link는 unavailable이다. next가 있으면 page 숫자만 1 증가해 고정 URL을 만든다. 3페이지에 next가 남으면 실패한다. 중복 PR id/number 레코드도 실패한다. 전체 목록 완료 후 merged_at!=null/state=closed/merge_commit_sha=after인 후보가 정확히 하나인지 확인하고 `/pulls/{number}` 상세를 조회한다. 목록에는 merged boolean이 없을 수 있으므로 최종 상세의 merged를 검사한다.
- [ ] malformed 후보 필드가 필터에서 조용히 누락되지 않도록 각 목록 항목의 필요한 필드 형태를 먼저 검증한다. 잘못된 형식은 unavailable, 0개/복수의 정상 후보는 rejected다. 후보와 상세를 Task 1에 넘기기 전에 identity 충돌을 검사하되 Git 부모 최종 판정은 Task 3에서 한다.
- [ ] 아래 실패군을 각각 독립 테스트로 추가한다. token canary와 응답 원문 canary가 최종 Error.message에 없고 호출 수가 한도를 넘지 않는지 단언한다.

| 실패군 | 테스트 동작/기대 |
| --- | --- |
| 401/403/404/429/500, fetch throw, 302 | unavailable, 자동 재시도 없음 |
| body null, malformed JSON, 객체인 목록, 배열인 상세 | unavailable |
| Content-Length >1MiB, 헤더 없이 실제 >1MiB, 거짓 작은 헤더 | unavailable, 추가 상세 요청 없음 |
| 2/3페이지 정상, 뒤 페이지 중복 후보, 3페이지 이후 next | 전체 확인 또는 실패, 첫 후보 조기 허용 금지 |
| fetch never settles, body.read never settles | timeoutMs=20 테스트, 500ms 안전 감시 내 unavailable |
| deadline 뒤 fetch resolve/reject·본문 완료 | 추가 요청 0, unhandled rejection 0 |
| 목록과 상세의 merged/id/SHA 변화 | rejected 또는 형태 불량 unavailable |
| token 누락/줄바꿈, 악성 repo 경로, invalid timeout | 요청 전에 unavailable/context-invalid |

- [ ] `node --test scripts/security/merge-evidence.test.mjs scripts/security/github-merge-evidence.test.mjs` 및 lint 실행. Expected: exit 0. HTTP 원문·토큰 비저장 확인 후 두 파일 커밋(`feat(ci): fetch bounded GitHub merge evidence`).

## Task 3 — Git 부모 확인·CLI·기존 게이트 연결

**Files:** 수정 scripts/security/git-change-reader.mjs, scripts/security-gate.mjs 및 .test.mjs, scripts/security/{gate,push-policy}.mjs 및 각 .test.mjs. 신규 scripts/security/git-merge-context.test.mjs.

**Interfaces:**
- Produces `readMainPushCommit({rootDir, head}) => {head:string, parents:string[]}` in git-change-reader.mjs. 기존 비공개 runGit/assertCompleteRepositoryHistory 재사용.
- Consumes Task 1 normalizeMainPushContext/assertMainMergeEvidence/withoutGithubCredentials, Task 2 loadGithubMergeEvidence.
- `assertCiPolicy({eventName,targetRef,base?,head?,mergeEvidence?}) => void`는 main에서 assertMainMergeEvidence({base,head,evidence:mergeEvidence})를 호출한다. 증빙 없으면 고정 rejected이며 pre-push는 변경하지 않는다.
- `runSecurityGate(options, dependencies)`의 동기 계약을 유지한다. options에 mergeEvidence만 추가하고 base/head와 함께 정책으로 전달한다. 네트워크는 호출하지 않는다.

- [ ] 실제 폐기용 Git 저장소에 base→tip 커밋을 만들고 부모를 읽는 테스트를 먼저 작성한다. fixture에는 임시 디렉터리/로컬 author만 사용하고 hooksPath를 빈 임시 폴더로 지정한다. 네트워크·실제 저장소 수정 없음.

```js
test("reads exact checkout and parent without accepting a stale head", async () => {
  const root=await mkdtemp(join(tmpdir(),"account-book-main-proof-"));
  const git=(...args)=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim();
  try {
    git("init"); git("config","user.name","Fixture");
    git("config","user.email","fixture@example.test");
    await mkdir(join(root,"empty-hooks"));
    git("config","core.hooksPath",join(root,"empty-hooks"));
    git("commit","--allow-empty","-m","base"); const base=git("rev-parse","HEAD");
    git("commit","--allow-empty","-m","tip"); const head=git("rev-parse","HEAD");
    assert.deepEqual(readMainPushCommit({rootDir:root,head}),{head,parents:[base]});
    assert.throws(()=>readMainPushCommit({rootDir:root,head:base}),{code:"GIT_READ_FAILED"});
  } finally { await rm(root,{recursive:true,force:true}); }
});
```

Run: `node --test scripts/security/git-merge-context.test.mjs`. Expected: missing export RED → implementation GREEN. 테스트 파일은 위 예제의 node:test/assert/fs/promises/os/path/child_process와 실제 readMainPushCommit import를 명시한다.

- [ ] runGit의 spawnSync 옵션에 `env:withoutGithubCredentials(process.env)`를 추가한다. readMainPushCommit은 head 형식 검사 → shallow 거부 → rev-parse HEAD 대조 → `rev-list --parents -n 1 <head> --`의 한 줄 출력 확인 순서로 실행한다. raw stderr는 공개하지 않는다.

```js
// readMainPushCommit 내부: 모든 출력 토큰은 SHA 형식을 검사한다.
assertValidRange(null,head);
assertCompleteRepositoryHistory(rootDir);
const actual=runGit(rootDir,["rev-parse","HEAD"],"utf8").trim();
const row=runGit(rootDir,["rev-list","--parents","-n","1",head,"--"],"utf8").trim();
const [returnedHead,...parents]=row.split(" ");
// actual/returnedHead가 head와 같고 단일 행·모든 SHA가 유효할 때만 아래 반환.
return {head:actual,parents};
```

- [ ] 위 임시 Git 테스트에 두 부모 merge(commit message 위장 포함), 루트 부모 0개, 없는 SHA, `--...` 입력, shallow clone을 추가한다. read 단계의 구조 결과와 Task 1 최종 허용을 구별한다. git replace로 결과를 바꾸지 않도록 main 조회에서 `--no-replace-objects`를 사용하고 해당 우회 회귀도 검사한다. 기존 전체 이력 reader에도 같은 옵션을 적용해 부모 검증과 scan이 서로 다른 그래프를 보지 않게 한다. 이 추가는 동일 신뢰 경계 강화이며 테스트·영향을 기록한다.
- [ ] gate 테스트에서 유효한 mergeEvidence가 정확한 base/head와 함께 전달되는지, 판정 실패 시 repository/blob/secret 단계가 호출되지 않는지 확인한다. 통과해도 blob scan을 생략하지 않는 사례를 추가한다.

```js
// gate.mjs의 기존 CI 분기에서 다음 세 필드를 추가로 전달한다.
operations.assertCiPolicy({eventName:options.eventName,targetRef:options.targetRef,
  base:options.base,head:options.head,mergeEvidence:options.mergeEvidence});
// runRepositoryChecks의 모든 spawnSync 옵션에도 다음을 추가한다.
// env: withoutGithubCredentials(process.env)
```

- [ ] CLI는 기존 option 목록을 유지한다. 새로운 allow-main/proof-json/token 옵션은 만들지 않는다. main 경로만 아래와 같이 연결한다. 이벤트 파일은 GITHUB_EVENT_PATH에서 읽되 크기 4MiB 초과·JSON 실패·누락은 context-invalid로 정규화한다. 이 로컬 읽기 한도는 대형 push 이벤트에서 안전한 확인 불가 실패를 낼 수 있음을 운영 기록에 남긴다.

```js
const token=process.env.GITHUB_TOKEN;
const options=parseArguments(process.argv.slice(2));
if (options.mode==="pre-push") options.updates=parsePrePushInput(readFileSync(0,"utf8"));
if (options.mode==="ci" && options.eventName==="push" && options.targetRef==="refs/heads/main") {
  // 파일 읽기/크기/JSON 실패는 MAIN_PUSH_CONTEXT_INVALID로 변환한다.
  const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,"utf8"));
  const context=normalizeMainPushContext({event,env:process.env,options});
  const commit=readMainPushCommit({rootDir:options.rootDir,head:context.after});
  const {candidate,pullRequest}=await loadGithubMergeEvidence(context,{token});
  options.mergeEvidence={context,candidate,pullRequest,commit};
}
const result=runSecurityGate(options);
// main 성공은 assertMainMergeEvidence가 다시 검증한 PR 번호/SHA와 scan 수만 출력.
// 비-main은 기존 안전한 출력 유지. 기존 catch의 원문 비공개 정책 유지.
```

- [ ] CLI의 기존 main 실패 테스트는 합성/누락 Actions 컨텍스트를 명시하고 새 context-invalid를 기대한다. 이 변경은 main 허용으로 테스트를 바꾸는 것이 아니다. 기존 direct local push, invalid option, 안전한 repository 오류, 실제 hook 전달 테스트는 유지한다.
- [ ] CLI 프로세스에서 token canary를 환경으로 전달하고 raw 오류/JSON/이벤트가 stderr에 나오지 않는지 검사한다. 자식 환경은 withoutGithubCredentials 결과를 사용함을 gate/Git 호출의 실제 테스트로 확인한다. 정상 CLI main 경로는 Node `--import` 테스트 전용 preload로 fetch만 대체하고 구조 파일이 있는 현재 checkout을 읽기 전용 검사한다. 실제 HEAD와 부모를 읽어 합성 event의 after/before 및 PR head를 맞춘다. 실제 push나 checkout 변경은 없다. preload/event 파일만 임시 디렉터리에 만들고 finally에서 정리하며 제품의 환경 기반 우회 스위치를 추가하지 않는다. 정상/없는 PR/HTTP 실패 3개 subprocess 결과와 코드가 일치해야 한다. 부모가 없는 Git fixture 실패는 위 별도 임시 저장소 테스트에서 다룬다.
- [ ] `pnpm test:security-gate`, `pnpm lint`, `pnpm test` 실행. Expected: 모두 exit 0. 새 테스트 수·원인별 RED→GREEN·Git 환경 위협 경계를 한국어로 기록하고 위 Task 3 파일만 커밋(`fix(ci): require merge proof for main gate`). 이 단계의 기존 workflow는 아직 main 증빙 조회 권한이 없으므로 실제 main 허용 완료라고 표시하지 않는다.

## Task 4 — 격리 workflow·정책 검사·문서·전체 검증

**Files:** 수정 .github/workflows/security-gate.yml, scripts/security/workflow-policy.test.mjs, docs/security/free-plan-compensating-controls.md; 신규 docs/status/2026-09-24-ci-merge-provenance.ko.md. 설계/계획의 상태 갱신 및 Notion 기록.

**Interfaces:** Task 3 CLI의 기존 인자 그대로 사용. Task 1 `assertProvenanceJobResult`를 첫 실행 검사에서 import. GitHub needs.main-provenance.result만 증빙 job 결과의 출처이며 외부 입력/임의 output flag는 사용하지 않는다.

- [ ] YAML을 먼저 바꾸지 말고 기존 정책 테스트에 두 job·권한·token 위치·검사 순서 기대를 추가해 RED를 확인한다. 기존 helper를 job 단위 블록에서 재사용한다. 전역 Action 개수 2→4는 두 job의 승인된 checkout/setup-node 한 쌍씩으로만 허용한다.
- [ ] workflow top-level `permissions: contents: read`, 기존 on/concurrency/service 및 승인된 Action SHA를 유지하고 다음 job 경계를 추가한다. 아래 조각 외 품질 검사 명령·순서는 기존 그대로 유지한다.

```yaml
  main-provenance:
    if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
    permissions:
      contents: read
      pull-requests: read
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Check out the exact main update
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
        with:
          fetch-depth: 0
          persist-credentials: false
          ref: ${{ github.sha }}
      - name: Use the repository-pinned Node version
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version-file: .nvmrc
          check-latest: false
      - name: Verify main merge provenance and changed history
        env:
          GITHUB_TOKEN: ${{ github.token }}
          EVENT_NAME: ${{ github.event_name }}
          TARGET_REF: ${{ github.ref }}
          BASE_SHA: ${{ github.event.before }}
          HEAD_SHA: ${{ github.sha }}
        run: >-
          node scripts/security-gate.mjs --mode ci --event "$EVENT_NAME"
          --target-ref "$TARGET_REF" --base "$BASE_SHA" --head "$HEAD_SHA"
  security-gate:
    needs: main-provenance
    if: ${{ !cancelled() }}
    permissions:
      contents: read
    # 기존 runner / timeout 30 / PostgreSQL service 유지.
```

- [ ] security-gate의 기존 checkout 다음, setup/install 전에 아래 step을 둔다. env 값은 expression을 셸 프로그램에 직접 삽입하지 않고 환경으로만 전달한다. GitHub runner 기본 Node로 짧은 순수 판정만 실행하며 뒤의 제품 검증은 기존 pinned Node를 사용한다.

```yaml
      - name: Require the expected provenance result
        env:
          EVENT_NAME: ${{ github.event_name }}
          TARGET_REF: ${{ github.event_name == 'pull_request' && format('refs/heads/{0}', github.base_ref) || github.ref }}
          PROVENANCE_RESULT: ${{ needs.main-provenance.result }}
        run: >-
          node --input-type=module -e
          'import { assertProvenanceJobResult } from "./scripts/security/merge-evidence.mjs";
          assertProvenanceJobResult({eventName:process.env.EVENT_NAME,
          targetRef:process.env.TARGET_REF,result:process.env.PROVENANCE_RESULT});'
```

- [ ] 기존 마지막 `Evaluate pushed or proposed commit range` step에만 `if: ${{ !(github.event_name == 'push' && github.ref == 'refs/heads/main') }}`를 추가한다. main 이력 검사는 앞 job에 있고 non-main에서는 그대로 실행한다. 나머지 품질/coverage/DB/browser/audit step에는 생략 조건·continue-on-error를 추가하지 않는다.
- [ ] 정적 정책 검사를 job 범위로 강화한다. permissions는 정확히 top-level + 두 job 3개이며 main job만 PR read를 가진다. github.token 참조는 정확히 main 증빙 step env 1곳이고 repository secrets 토큰은 여전히 0개다. main에는 install/app 실행 없음, 품질 job에는 PR 권한/token 없음, 두 checkout 모두 full history/no persisted credentials다. main checkout은 github.sha로 고정하며 품질 PR checkout의 기존 merge 결과 동작은 유지한다.
- [ ] canonical YAML 해시는 전체 diff 검토 후 계산해 갱신한다. 원문 해시만 맞추고 구조 검사를 삭제하지 않는다. helper는 현재 YAML subset 검사임을 유지하며 새 job/if/needs가 포함된 원문 전체 해시가 추가 우회 문법을 막는 역할을 계속한다.
- [ ] job 결과 테스트에서는 추출한 실제 workflow run 문자열을 합성 EVENT_NAME/TARGET_REF/PROVENANCE_RESULT로 실행한다. 표의 success/failure/cancelled/skipped 각각 exit code를 확인해 스크립트 문자열과 함수의 연결도 검증한다. workflow에서는 main 증빙 실패일 때 품질 job이 첫 검사에서 실패하거나 전체 취소일 때 cancelled로 남아야 하며 success/skipped를 성공 근거로 보고하지 않는다.
- [ ] 아래 focused 명령을 실행하고, 구조/해시 테스트만 맞춘 것이 아니라 실제 main 증빙 CLI까지 통과하는지 확인한다.

```powershell
pnpm test:security-gate
pnpm verify
pnpm --filter @account-book/web test:coverage
git diff --check
```

Expected: 모두 exit 0, 기존 인증 branches=100. DB/browser 실환경은 별도 승인 후 GitHub의 폐기용 환경 CI에서 확인한다. 전체 테스트 수는 실행 결과를 기록하며 이전 1,011을 새 수치로 복사하지 않는다.
- [ ] free-plan-compensating-controls의 squash-only 안내를 merge/squash 지원과 여러 커밋 rebase 미지원으로 갱신한다. API 확인 불가와 실제 정책 위반을 구분하고 같은 이벤트 재실행·증거 보존 절차, token 권한·4MiB 이벤트 입력 한도·서버 보호와의 차이를 적는다. status 문서에는 실제 파일/줄 수·각 명령/SHA/결과·미검증 hosted/post-merge 범위를 기록한다.
- [ ] Task 4 파일을 커밋(`fix(ci): isolate and enforce main provenance checks`). 전체 변경 독립 리뷰 후 중요한 지적을 실패 재현부터 수정한다. 원문/비밀값 없는 리뷰 결과와 보류 의견을 Notion에도 기록한다.

## 배포가 아닌 Git 반영 절차

구현 계획 확인은 push/PR 생성·병합·배포를 자동 승인하지 않는다. 코드/문서 커밋 후 현재 상태를 보고하고 승인된 범위에서 기능 브랜치 push 및 PR 생성으로 이어간다. PR의 최신 head CI와 사전 검토를 확인하고 별도 승인된 merge 뒤 **새 main push 이벤트**에서 증빙 성공을 확인한다. 과거 실패 run 재실행을 새 코드 검증으로 주장하지 않는다. 직접 main push/force push 실험은 하지 않는다.

## 자체 점검·실행 방식

- [x] 설계 1~3절 목표/신뢰 경계: 공통 제약·오류·운영 문서에 대응.
- [x] 설계 4절 이벤트/PR/Git 부모: Task 1/2/3으로 분리하고 실제 입력 검사를 명시.
- [x] 설계 5~7절 권한/한도/로그: Task 2/3/4와 실패·취소 행렬에 대응.
- [x] 설계 8~9절 파일 크기/검증: 파일 지도 19개, 집중·전체·coverage·CI·post-merge를 구별.
- [x] 단계 간 함수명/인자/반환 계약 대조. pure 판정은 push-policy를 import하지 않아 순환 참조를 만들지 않는다. Git reader는 merge-evidence의 순수 환경 함수만 import한다.
- [x] 모호한 구현 지침·빈 항목 점검. 설계에 없던 Git replace 방어와 이벤트 파일 4MiB 제한은 구현 세부 사항으로 명시하고 실제 영향 검증을 포함했다.
- [ ] 사용자의 계획 검토 및 이번 작업 실행 방식 선택.
- [ ] Task 1~4 구현·독립 리뷰·한국어 결과 기록.

권장 방식은 **현재 세션 순차 구현 + 마지막 독립 리뷰**다. 네 작업이 같은 증빙 계약을 순서대로 소비하므로 한 구현자가 이어가면 문맥 전달·수정 비용이 적다. 보안 판단의 중요성 때문에 마지막 리뷰는 별도 에이전트로 수행한다. 대안인 작업별 독립 구현·리뷰는 각 단계에서 별도 점검을 받는 장점이 있지만 비용이 더 든다. 이전 인증 작업의 실행 방식 승인을 이번 계획 승인으로 확대하지 않는다.
