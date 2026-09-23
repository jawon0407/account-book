# Vitest 보안 패치 Implementation Plan

> **후속 전송 승인 (2026-09-14):** 사용자가 완료된 6파일의 커밋·푸시를 승인했다. 아래 미커밋·미푸시는 패치 검증 완료 시점 기록이다. 전송 전 `pnpm verify`를 재실행하고 보안 훅을 통과한 뒤 로컬 HEAD와 원격 SHA를 비교한다. 기존 `.gitignore` 수정은 제외한다. PR·병합·배포는 포함하지 않는다. 다음 인증 시간 제한은 상세 설계 단계이며 제품 로직을 자동으로 변경하지 않는다.

> **For agentic workers:** Use superpowers:subagent-driven-development for the dependency task; controller owns verification and Korean result documentation. No commit or push in this execution.

**Goal:** GHSA-82fw-gwwq-j7x9에 해당하는 테스트 도구 의존성을 최소 패치로 교체하고 기존 검사 동작을 보존한다.

**Architecture:** 제품 로직은 변경하지 않는다. 루트의 Vitest와 coverage-v8 버전을 함께 올리고 pnpm이 lockfile을 갱신하도록 한다.

**Tech Stack:** Node 22.15.1, pnpm 11.9.0, Vitest/coverage-v8 4.1.11.

**Spec:** 2026-09-11 다음 작업 제안과 2026-09-14 사용자 승인(추천대로 진행). 공식 근거: https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9

## Global Constraints

- 기준 HEAD `f7ba1e5`, 브랜치 `hotfix/vitest-security-20260914`; 기존 linked worktree를 재사용한다.
- `vitest`와 `@vitest/coverage-v8`를 정확히 `4.1.11`로 맞춘다.
- 제품 코드·DB·UI·테스트 사례·coverage 임계값·pnpm 보안 설정·기존 `.gitignore` 수정은 변경하지 않는다. 기존 정책 테스트의 정확한 기대 버전 2개는 패치 버전으로 동기화한다.
- 커밋·푸시·PR·병합·배포, 인증 시간 제한, R2 이후는 이번 실행 범위가 아니다.
- 실제 secret, 금융 데이터, 외부 IdP 호출은 사용하지 않는다.

## 작업 지도와 승인 범위

| 파일 | 변경 | 역할 |
| --- | --- | --- |
| `package.json` | 2개 버전 값 수정 | 테스트 실행기와 coverage provider의 호환 버전 고정 |
| `pnpm-lock.yaml` | pnpm 재생성 | 실제 설치되는 간접 의존성과 무결성 고정 |
| `scripts/workspace-policy.test.mjs` | 기대 버전 2개 수정 | 승인한 도구 버전을 정확히 검사하는 기존 정책 유지 |
| 이 실행 계획 | 신규 | 범위·검증·결과·한계 기록 |
| `docs/guides/security-auth-testing.md` | 결과 추가 | 초급 개발자용 패치 검사 설명 |
| `docs/status/2026-08-24-development-progress.ko.md` | 최신 상태 추가 | 완료 범위와 다음 작업 구분 |

6파일의 소규모 변경이다. 사전 제안 5~6파일 범위에서 정책 테스트의 고정 버전 2개 동기화 필요성을 확인했고 수정 전 사용자에게 알렸다. lockfile은 연결된 버전 표기로 diff가 커질 수 있으나 제품 코드 재작성은 아니다. 새 테스트는 추가하지 않으며 기존 정책 테스트의 버전 불일치 실패와 동기화 후 통과를 기록한다. 기준 audit에서 동일 공지가 vitest/mocker 2개 패키지로 보고된 것을 재확인한다.

### Task 1: 테스트 도구 패치 및 의존성 확인

**Files:** Modify `package.json`, `pnpm-lock.yaml`, `scripts/workspace-policy.test.mjs` only. Controller owns the three documentation files.

**Interfaces:** 소비하는 입력은 루트 devDependencies와 기존 workspace 설정이다. 산출물은 호환되는 Vitest/coverage-v8 및 mocker 4.1.11 설치 그래프이며 공개 함수 변경은 없다.

- [x] 기준 `pnpm test` 종료 코드 0을 controller가 확인한 뒤 수정한다.
- [x] `scripts/workspace-policy.test.mjs`의 기대 버전 2개를 `4.1.11`로 수정하고 4개 사례·49개 assertion을 유지했다. **절차 이탈:** 사전 RED는 실행하지 못했다. 사후에 이전 커밋 테스트를 메모리에서 현재 저장소에 연결하면 기대 버전 불일치로 3개 통과/1개 실패(exit 1), 현재 테스트는 4개 통과(exit 0)였다. 이를 test-first RED로 간주하지 않는다.
- [x] apply_patch로 package.json의 다음 두 값을 수정한다.

```json
"@vitest/coverage-v8": "4.1.11",
"vitest": "4.1.11"
```

- [x] `pnpm install --ignore-scripts`로 lockfile/설치 상태를 갱신했다. pnpm 보안 설정을 유지했다.
- [x] `pnpm install --frozen-lockfile --ignore-scripts`로 재현 가능한 해석을 확인했다.
- [x] `pnpm exec vitest --version`, `pnpm list vitest @vitest/coverage-v8 --depth 0` 및 lockfile의 mocker 버전을 확인했다.
- [x] 전체/운영 audit의 결과를 확인했다. 모두 종료 코드 0, 알려진 취약점 0건이다.
- [x] 세 파일의 diff를 자체 검토했다. Vitest 계열 외 의존성 이동은 없다.
- [x] 커밋 없이 report에 명령·종료 코드·결과·우려를 기록했다.

## Controller 검증 및 완료 기준

- [x] 전체 `pnpm verify` 최종 실행에서 878개 테스트·lint·타입·API/웹 빌드 통과(exit 0)를 확인했다. 최초 시간 초과 실패도 보존했다.
- [x] coverage 수집 유지 확인: 734/799 branches=91.86%, 기존 100% 임계값 미달로 exit 1. 측정값/임계값을 낮추지 않았다.
- [x] task 명세·품질 및 최종 전체 변경 리뷰를 수행했다. 코드 지적 없음. 사전 RED 누락은 사후 검사와 구분해 절차 이탈로 기록했다.
- [x] 한국어 문서에 패치 이유, 패키지/lockfile 관계, 명령·실제 결과, 미검증 범위를 기록했다.
- [x] `git diff --check`, 변경 파일 목록과 기존 `.gitignore` 보존을 확인했다.

## 검증 범위의 한계

이 공지는 개발 서버의 mock 등록·파일 접근 경계에 관한 것이다. 해당 패키지 버전이 있다는 사실만으로 운영 금융 데이터 유출이나 실제 공격 성공을 의미하지 않는다. 패키지 검사·회귀 테스트는 침투 테스트가 아니며 실제 hosted 인증·DB·한국망 지연·FCP 검증도 아니다. GitHub 기본 브랜치 알림은 로컬 수정만으로 닫히지 않는다.

## 실행 결과

- 기준 `pnpm test`: 종료 코드 0, 878개 테스트 통과. 기준 audit는 moderate 2건으로 종료 코드 1이다.
- 패키지·coverage-v8·mocker를 4.1.11로 갱신했다. 선언·정책 테스트는 각 2줄, lockfile은 56줄 추가/56줄 삭제이며 다른 제품 의존성 버전은 변경하지 않았다.
- 설치와 frozen install은 종료 코드 0이다. 전체 audit/운영 audit는 모두 종료 코드 0, 알려진 취약점 0건이다.
- coverage는 이전과 동일한 branches 734/799=91.86%다. 웹 510개 테스트는 통과했지만 기존 100% 기준 미달로 명령 종료 코드 1을 유지한다. 이 패치는 기존 커버리지 부족을 해결한 작업이 아니다.
- 최초 전체 verify는 route-wiring 테스트의 5초 초과로 exit 1이었다. 단독 16/16 통과(1.71초) 및 코드·timeout 설정을 바꾸지 않은 최종 전체 verify는 878개·lint·타입·API/웹 빌드 exit 0이다. 원인을 확정하거나 패치로 해결했다고 주장하지 않는다.
- task 리뷰는 코드 품질 승인, 사전 RED 미실행을 절차 이탈로 지적했다. 사후 구버전 기대값 실패/새 기대값 통과를 확인했고 시간 순서를 소급해 주장하지 않는다. 최종 전체 6파일 리뷰는 수정이 필요한 코드·보안·범위 지적 없음으로 완료됐다. 결과 문서를 마지막으로 동기화했으며 미커밋·미푸시 상태로 브랜치와 작업 기록을 보존한다.
