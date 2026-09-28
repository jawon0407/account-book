# 외부 코드 라이선스 고지 보완 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 기존 현재 세션 순차 실행 방식을 유지하고 최종 독립 검토를 받는다.

**Goal:** 이미 포함된 외부 디자인 도구의 출처·버전·재배포 고지를 정확히 보존한다. 앱 전체의 라이선스는 변경하지 않는다.

**Architecture:** 외부 코드 105개는 그대로 두고 루트 고지 지도와 구성요소별 원문 파일을 추가한다. 외부 도구의 실행·설치·업데이트 없이 파일 내용 해시로 출처를 검증한다.

**Tech Stack:** Markdown, 원본 라이선스 텍스트, Git blob/SHA-256, 읽기 전용 GitHub API, 공식 npm 배포본 무결성 비교.

**Spec:** [공개 전 노출 감사 G2](../../security/2026-09-28-public-exposure-audit.ko.md), [작업 변경 절차](../../guides/change-workflow.ko.md).

상태: 2026-09-28 승인 범위 로컬 반영·문서 검증·독립 검토·Notion 기록 완료. 사용자에게 로컬 결과를 인계한다. 커밋·push·공개 전환은 하지 않았다.

## Global Constraints

- 외부 코드·앱·DB·테스트·CI·의존성/lockfile·사용자 .gitignore 변경 없음.
- 앱 루트에 새 LICENSE를 만들어 전체 앱에 Apache/MIT를 부여하지 않는다.
- 원문 라이선스와 copyright/NOTICE는 요약·번역으로 대체하거나 이름을 임의 보충하지 않는다.
- Impeccable live 도구는 기존 보안 검토 결과에 따라 계속 실행 보류한다. 고지 추가는 보안 문제 수정이 아니다.
- 공개 전환 허용 의향과 개별 개인정보/권리 확인을 구분한다. G1 작성자 정보, G3 최종 목록·권리는 계속 확인한다.
- Git 이력 재작성·강제 push·PR 병합·원격 설정은 이번 문서 보완의 부수 효과가 아니다.
- 이번에는 제품 테스트를 새로 만들지 않는다. 원문 동일성·출처·파일 불변·링크·diff를 검증한다.

## Review Focus

1. 표시 버전 3.9.1을 릴리스 태그와 같은 것으로 오인하지 않기 → 검증된 스냅샷 SHA와 105파일 비교 결과 기록.
2. 번들 파일명이 다르다는 이유로 다른 패키지로 판단하지 않기 → npm `package/dist/index.js`와 현재 UMD 바이트 비교.
3. 상위 프로젝트 고지만 붙이고 파생 플랫폼 문서의 MIT 고지를 누락하지 않기 → 원본 NOTICE의 두 문서와 라이선스 대응 확인.
4. 고지 보완을 앱 전체 라이선스/보안 해결/공개 승인 완료로 확대하지 않기 → 고지 범위와 남은 공개 조건 명시.
5. 라이선스 원문 변경·줄바꿈 손상·기존 외부 파일 변경을 놓치지 않기 → 네 원문 SHA-256과 기존 105파일 blob 확인.

## 1. 조사 결과와 선택 근거

### Impeccable

- 로컬 도입 커밋: `071b831`, 2026-07-16. 이후 대상 폴더의 커밋 변경 없음, 현재 작업 파일도 HEAD와 일치.
- 표시 버전은 3.9.1이다. `skill-v3.9.1` 태그 SHA `44c27a72af98394c32691ba79358811bff86bde6`와 비교하면 73/105만 일치한다.
- 공식 스냅샷 **`da99645a58400ed7acb201e6904f9413efd89c6e`**에서는 동일 경로의 **105/105가 일치**한다. 최초 다운로드 경로 자체를 재현한 것이 아니라 내용의 출처 일치를 확인한 것이다.
- 따라서 고지에는 `3.9.1 표시 / 공식 snapshot da99645...와 일치`라고 쓰고 릴리스 태그 원본이라고 쓰지 않는다.
- 해당 스냅샷은 Apache-2.0 LICENSE와 Platform Design Skills를 설명하는 NOTICE.md를 제공한다.

### modern-screenshot

- Impeccable의 package/lock 정보는 4.7.0을 가리킨다. 공식 npm `modern-screenshot@4.7.0`의 tarball integrity를 SHA-512로 확인했다.
- 로컬 `scripts/modern-screenshot.umd.js`는 배포본 `package/dist/index.js`와 내용이 일치한다. 파일명만 다르다.
- 로컬 LF 정규화 SHA-256: `bb36665889124a0b6e15f16045265737449c3bdcf2712cdb08af3cfa01563e2b`.
- npm LICENSE와 공식 v4.7.0 커밋 `792d6db7411839c62940a6e930161f8e376e817f`의 LICENSE가 일치한다.
- 패키지를 설치·실행하지 않았다. tarball은 메모리에서 읽고 필요한 내용만 비교했다.

### Platform Design Skills

- Impeccable NOTICE는 `reference/ios.md`, `reference/android.md`가 ehmo/platform-design-skills의 파생 문서임을 명시한다.
- 도입 스냅샷 이전의 공식 커밋 `dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9`에서 MIT LICENSE를 확인했다.
- Impeccable이 사용한 원본의 정확한 커밋은 NOTICE에 적혀 있지 않다. 이 커밋은 보존할 라이선스 원문의 확인 출처이며, 파생 문서의 정확한 베이스라고 단정하지 않는다.

### 대안 비교

| 방식 | 장점 | 단점 | 판단 |
| --- | --- | --- | --- |
| 기존 복사본 유지 + 고지 추가 | 기능/도구 코드 불변, 출처 검증 가능, 작은 변경 | 업데이트 때 고지·버전도 함께 검토 필요 | 권장 |
| 복사본을 Git에서 제외하고 재설치 방식으로 전환 | 저장소 외부 코드 양 감소 | 과거 이력에는 남음, 개발 환경·설치 재현성 변경 | 별도 리팩터링으로 분리 |
| 최신 버전으로 교체하면서 고지 추가 | 최신 배포 체계 사용 가능 | 105개 이상의 코드 변경과 보안/호환 검증 필요 | 이번 범위 제외 |

## 2. 파일 지도와 규모

핵심 고지 5파일 + 계획·연결·결과 기록 5파일 = **총 10파일**. 예상은 약 380~480줄이었다. 실제 고지 신규 288줄(원문 232줄 포함), 이 계획 149줄, 나머지 4문서 순증 16줄이다. 계획 작성부터의 순증은 453줄, 이번 구현 승인 후만 비교하면 324줄이다. 앱 코드 변경은 0줄이다.

| 파일 | 작업 | 목적·예상 줄 수 |
| --- | --- | --- |
| `THIRD_PARTY_NOTICES.md` | 신규 | 구성요소·출처 SHA·적용 경로·한계, 50~80줄 |
| `licenses/impeccable/LICENSE` | 신규 | Apache-2.0 원문, 191줄 |
| `licenses/impeccable/NOTICE.md` | 신규 | 해당 스냅샷의 제3자 고지 원문, 11줄 |
| `licenses/modern-screenshot/LICENSE` | 신규 | 4.7.0 MIT 원문, 약 9줄 |
| `licenses/platform-design-skills/LICENSE` | 신규 | 파생 문서의 MIT 원문, 21줄 |
| 이 상세 계획 | 신규 | 조사·작업·검증 기록, 약 120줄 |
| `README.md` | 수정 | 루트 고지 문서 링크, 2~4줄 |
| `docs/README.md` | 수정 | 출처/고지 문서 진입 링크, 2~4줄 |
| `docs/security/2026-09-28-public-exposure-audit.ko.md` | 수정 | G2의 조사/반영/남은 조건 구분, 8~15줄 |
| `docs/status/2026-09-24-ci-merge-provenance.ko.md` | 수정 | 실제 결과 및 원격 미반영, 6~10줄 |

`licenses/`는 보관 위치일 뿐 라이선스 적용 범위를 폴더명으로 결정하지 않는다. 루트 고지에서 실제 `.agents/skills/impeccable/` 경로와 각 라이선스를 연결한다. 기존 스킬 폴더는 수정하지 않는다.

## 3. 원문 검증 계약

| 대상 | 공식 Git blob | SHA-256 (원문 바이트) |
| --- | --- | --- |
| Impeccable LICENSE | `bb3f6d23b1f8025514a62a12b51b47d73e3c9aa9` | `02bb8c3b4e70190e3986c0404ad2fd8d639b4f534252d82379cc1b502b6d1812` |
| Impeccable NOTICE | `0468271c904ae334cfaf27da6f8df3d5f419a1f0` | `c60a093c2845fd9fb82f9c6f742ece31f379f8190b535309d32d66c45ccffdcb` |
| modern-screenshot LICENSE | `c83888272c1ec834dc656067a5ab9e8af12b82fb` | `1daae2db27daba18a7e21bb56e12e19b8de6c1197658921f09bbe550f7106579` |
| Platform Design Skills LICENSE | `14fac913ccf80234b1848540089a3bbcb6e5283d` | `1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685` |

LF 원문과 최종 newline 유무를 보존한다. 검증을 통과시키려고 원문을 요약하거나 hash 기준을 임의 변경하지 않는다. `.gitattributes`의 정규화와 실제 바이트 차이는 구분해서 기록한다.

### Task 1: 고지 원문과 출처 지도

**Files:** 신규 고지 5파일. **Interfaces:** 입력은 위 고정 커밋·원문/해시, 출력은 앱 라이선스와 분리된 파일별 고지다. 런타임 함수나 API는 없다.

- [x] 공식 snapshot의 105개 blob 일치와 npm bundle/integrity/라이선스 일치를 읽기 검증한다.
- [x] 사용자의 상세 파일 지도 확인을 받은 뒤 apply_patch로 네 원문을 그대로 추가한다.
- [x] THIRD_PARTY_NOTICES에 구성요소·적용 경로·버전/스냅샷·원문 링크·변경 여부를 쓴다. 플랫폼 베이스 미상은 그대로 밝힌다. 확인한 105파일 내용 불변과 파일명 매핑을 명시한다.
- [x] 원문 hash 4개를 대조하고 외부 코드 105개가 기존 HEAD와 일치하는지 재검증한다. root LICENSE/package license 필드가 새로 바뀌지 않았는지 확인한다.

### Task 2: 연결·상태 기록·최종 확인

**Files:** README 2개, 감사/진행 문서, 이 계획. **Interfaces:** Task 1의 실제 고지 파일을 가리키는 로컬 링크와 검증 결과만 추가한다.

- [x] README와 docs 지도에 고지 링크를 추가한다. 감사 G2는 로컬 반영과 원격 미반영을 구분하고 G1/G3/P1을 자동으로 닫지 않는다.
- [x] 로컬 링크 존재, `git diff --check`, 정확한 신규/수정 파일 목록과 줄 수를 확인한다. 앱 전체 테스트를 수행했다고 적지 않는다.
- [x] 현재 세션 실행 방식으로 반영 후, 새 검토자가 고지 대상·원문·범위·남은 gate를 읽기 검토한다. 법률 자문 완료로 표현하지 않는다.
- [x] Notion 기존 진행 페이지에 실제 결과를 추가하고 재조회한다. 기록에는 비밀값·개인 이메일 원문을 넣지 않는다.
- [x] 결과를 사용자에게 보고한다. 커밋/push, 공개 전환 시점과 최종 개인정보·권리·원격 보호 절차는 별도로 확인한다.

## 4. 자기 검토와 현재 증거

- G2 요구는 Task 1, 공개 범위와 다른 gate 구분은 Task 2에 대응한다. Review Focus 5개 모두 파일 비교/링크/범위 확인 단계에 배정했다.
- 105/105 upstream 비교, 105/105 HEAD 일치, npm tarball integrity, 번들 내용 및 LICENSE 일치는 2026-09-28 새로 실행한 결과다.
- 기록 도구와 원문 조회 결과는 Git 제외 `.superpowers/public-audit/license-provenance-*.json`, `license-artifacts.json`에 보관한다. 외부 저장소 instructions는 실행하지 않았다.
- 필요한 Apache 원문·기존 NOTICE·MIT 2종을 복사했고 4개 SHA-256이 모두 일치한다. 기존 외부 파일 105개도 HEAD와 일치한다. 새 고지 지도는 56줄, 원문은 합계 232줄(마지막 LF 없는 파일을 한 줄로 세는 방식)이다.
- 아직 실행하지 않은 사항: 커밋/push/공개·보호 적용, 앱 전체 테스트·DB·브라우저 E2E. 기존 앱 테스트 수치를 이번 문서 검증으로 재사용하지 않는다.

### 실행 중 판단과 검증

- 승인한 문서 전용 범위를 따라 제품 테스트·설치 대신 원문 해시·로컬 링크·파일 불변을 검사한다. 런타임 영향 누락 위험은 작업 시작 시 423파일의 해시를 저장하고 이번 허용 10파일 외 변경을 거부하는 방식으로 확인한다.
- apply_patch가 붙이는 마지막 LF를 modern-screenshot LICENSE 한 곳에서만 해시 조건부 포맷 명령으로 제거했다. 원본에 마지막 LF가 없기 때문이며, 이후 원문 SHA-256 일치를 확인했다. 다른 내용은 바꾸지 않았다.
- 커밋이 승인되지 않았으므로 전용 실행 기록은 삭제하지 않고 Git 제외 경로에 유지한다. 미커밋 결과의 복구 근거를 잃지 않기 위한 것이며 로컬 임시 자료가 남는 비용이 있다.
- 실행 명령: `node .superpowers/sdd/2026-09-28-third-party-license-notices/verify.mjs originals`. 최초 고지 누락 5건을 검출한 뒤 추가 후 `PASS originals=4 vendor=105`, exit 0이다. 이는 제품 TDD 통과 주장이 아니라 문서 검증이다.
- 연결 검증: `verify.mjs all`에서 원문 4개·외부 파일 105개·로컬 링크 74개, 허용 10파일 범위와 diff 공백 검사를 통과했다.
- 검토 기준은 커밋 범위가 아니라 작업 시작 파일 해시와 실제 미커밋 10파일이다. 커밋 전용 검토 도구는 신규 미추적 고지를 포함하지 않으므로, 검토자에게 실제 파일·검증 결과·기존 브랜치 변경 구분을 직접 전달한다. 누락 위험은 10파일 목록과 원문 해시로 확인한다.
- 신규 파일 공백 검사기의 Git `--no-index --check` 종료 코드 해석 오류를 발견했다. 정상 차이도 1을 반환하므로 종료 코드만으로 실패 처리했던 것을 수정했다. 정상 파일·의도적 trailing whitespace·미존재 경로 대조 3/3 후 재통과했고, 고지 내용이나 제품 코드는 변경하지 않았다.

### 최종 검토·인계 결과

- 독립 검토: Critical 0 / Important 0 / Minor 0. 새 검토자가 공식 원문 4개·105개 Git blob·npm 4.7.0 tarball 무결성/번들/LICENSE를 직접 대조했다. 새로 보류한 경미한 지적은 없다.
- 검토 제외 판단: 기존 CI·보안 구현은 이번 수정 이전의 별도 검토 대상이다. 이번 결과를 그 구현의 재검증으로 취급하면 기존 P1을 놓칠 수 있으므로 미종결을 유지한다.
- 검토 제외 판단: 외부 도구 실행 안전성·앱/DB/E2E는 동작 변경이 없는 문서 범위 밖이다. 동작 검증 누락 위험은 남으며 실제 출시 전에 별도 검사한다.
- 검토 제외 판단: 법률 자문·전체 패키지 권리 적합성은 지정 복사본 원문 보존 검토와 다르다. 미검토 의존성의 법적 위험까지 해결됐다고 주장하지 않는다.
- 검토 제외 판단: G1 개인정보·G3 권리/최종 목록·P1 원격 보호는 여전히 미종결이다. 미확인 상태로 공개하면 노출·병합 보호 위험이 있으므로 이번에 공개하지 않는다.
- Notion 기존 10-A 진행 페이지에 `라이선스 고지 로컬 반영 · 독립 검토 완료`를 추가하고 재조회했다. GitHub visibility도 읽기 조회에서 PRIVATE였다.
- 현재 기능 브랜치와 미커밋 작업을 보존한다. `finishing-a-development-branch`의 보존 인계 원칙을 적용하며 통합 메뉴·전체 앱 테스트·원격 작업은 승인된 문서 범위에 추가하지 않는다.

## 5. 고정 출처

- [Impeccable 일치 스냅샷](https://github.com/pbakaus/impeccable/tree/da99645a58400ed7acb201e6904f9413efd89c6e) — GitHub API tree의 truncated=false와 blob 일치 확인.
- [Impeccable LICENSE](https://github.com/pbakaus/impeccable/blob/da99645a58400ed7acb201e6904f9413efd89c6e/LICENSE), [NOTICE](https://github.com/pbakaus/impeccable/blob/da99645a58400ed7acb201e6904f9413efd89c6e/NOTICE.md).
- [modern-screenshot 4.7.0 메타데이터](https://registry.npmjs.org/modern-screenshot/4.7.0), [MIT 원문](https://github.com/qq15725/modern-screenshot/blob/792d6db7411839c62940a6e930161f8e376e817f/LICENSE).
- [Platform Design Skills MIT 원문](https://github.com/ehmo/platform-design-skills/blob/dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9/LICENSE).

브라우저 검색 도구에서는 일부 고정 커밋 URL이 cache miss였으나 GitHub 공식 API로 원문과 해시를 읽었다. 이를 원문 접근 불가로 숨기거나, 반대로 웹 화면 검증까지 완료했다고 표시하지 않는다.
