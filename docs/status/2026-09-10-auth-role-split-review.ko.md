# 인증 코드 역할별 분리 사전 검토

> 프로젝트 전체 폴더 구조와 후속 분리 후보는 [전체 리팩터링 지도](2026-09-10-project-refactoring-map.ko.md)를 참고한다. R1은 2026-09-10 사용자 “시작하자”로 승인됐다. [실행 계획](../superpowers/plans/2026-09-10-auth-adapter-role-split.md)에 파일 지도와 검증 기준을 고정했다.

- 상태: **R1 구현·로컬 검증·독립 리뷰 완료 / 미커밋**. 기능 브랜치 `feature/auth-adapter-role-split`에서 동작 보존 분리만 수행했다. 공개 어댑터625→248줄, 내부 제품5파일47~119줄. 최종 전체878tests·lint·타입·build 통과. 선택적 branches91.86%는 기존100% 기준 미달로 남는다. [실행 결과](../superpowers/plans/2026-09-10-auth-adapter-role-split.md#구현-결과-및-실제-크기)를 우선하며 아래 후보/예상 표현은 승인 전 계획 기록이다.
- 기준: 2026-09-10, `66a2319`, `feature/vercel-region-policy`.
- 사용자 요구: 파일별 코드가 길어 역할별로 더 나누고, 새 개발도 이 원칙으로 진행한다.
- 이전 인증 시간 제한 제안보다 **동작을 바꾸지 않는 파일 분리**를 먼저 수행한다. 인증 시간 제한과 R2 이후는 이번 구현 범위가 아니다.

## 현재 확인

줄 수는 주석·빈 줄을 포함한다. 큰 파일이라는 사실만으로 나쁜 구조라고 단정하지 않는다.

| 파일 | 줄 수 | 이번 취급 |
| --- | ---: | --- |
| `apps/web/src/server/http/auth-controller.ts` | 779 | 이후 별도 후보. 요청 검증·응답·작업별 핸들러 책임을 검토 |
| `apps/web/src/server/auth/supabase-auth-adapter.ts` | 625 | 우선 분리. 검증·토큰 파싱·오류 변환·직접 HTTP·SDK 생성·인증 흐름이 함께 있음 |
| `apps/web/src/server/persistence/postgres-auth-repository.ts` | 589 | 이후 별도 후보. 트랜잭션 원자성과 연결 소유권을 유지해야 함 |
| `apps/web/src/server/session/session-service.ts` | 408 | 필요성이 확인될 때 별도 검토 |
| `apps/web/src/server/auth/supabase-auth-adapter.test.ts` | 465 | fixture와 시나리오별 테스트 분리 후보 |

## 대안

| 안 | 장점 | 단점 |
| --- | --- | --- |
| A — 추천: Supabase 어댑터부터 책임별 분리 후 시간 제한 구현 | 다음 작업 영역을 먼저 정리하며 변경 원인·회귀 추적이 쉬움 | 큰 컨트롤러·저장소 파일은 이번에 그대로 남음 |
| B: 시간 제한을 추가하면서 함께 분리 | 한 번에 최종 구조로 접근 | 코드 이동과 동작 변경이 섞여 실패 원인과 리뷰 범위가 커짐 |
| C: 전체 큰 파일 일괄 분리 | 프로젝트 구조를 전반적으로 정리 | 인증·DB·HTTP 경계가 동시에 바뀌고 금융 기능 착수가 지연됨 |

## A안의 첫 구조

기존 `auth/supabase-auth-adapter.ts` 파일과 공개 클래스·생성자·메서드 계약은 유지한다. 호출자가 파일 이동을 따라 대규모 수정하지 않게 하고, 실제 흐름 조합만 남긴다. 아래는 후보 구조이며 분리는 줄 수가 아닌 책임 기준이다.

```text
auth/
  supabase-auth-adapter.ts       # 공개 진입점, 호출 순서와 성공/실패 흐름
  supabase/
    validation.ts              # URL·설정·문자열·UUID·PKCE 입력 검증
    session-parser.ts          # SDK/HTTP 응답과 토큰·사용자·만료 일관성 검증
    error-mapper.ts            # 원시 오류를 고정 앱 오류로 변환
    http-client.ts             # 직접 HTTP POST와 JSON 읽기
    sdk-client.ts              # 비영속 SDK 생성 옵션·타입·생성 함수
```

예상 파일 크기는 진입점 180~260줄, 나머지 각 50~180줄 정도다. 정확한 수치는 이동 후 결정하며 상한에 맞추려고 코드를 한 줄로 압축하거나 의미 있는 주석을 삭제하지 않는다. 필요하면 중복된 영문/한글 JSDoc을 한 블록으로 정리하되 함수 역할·매개변수·반환·오류 설명은 유지한다.

의존 방향은 진입점→통신/응답 해석→입력 검증/오류 경계로 한 방향을 유지한다. 오류 변환은 입력 검증을 역으로 참조하지 않는다. 타입은 사용하는 모듈에 두고 기존 외부 타입 경로는 필요할 때 type-only 재노출로 유지한다. 모호한 `utils.ts`·불필요한 barrel index·함수마다 별도 파일·기반 클래스는 만들지 않는다.

server-only 표식과 서버 토큰 경계를 유지한다. JWT 클레임 해석을 암호학적 서명 검증으로 이름 붙이거나 설명하지 않는다. 이번 단계에는 timeout·재시도·SDK 교체·오류 코드·검증 규칙 변경을 넣지 않는다.

## 테스트와 설정 파일 지도

- 기존 `apps/web/src/server/auth/supabase-auth-adapter.test.ts`: 공개 어댑터 통합·HTTP/SDK 연결 계약을 유지하고, 아래 시나리오를 이동한다.
- 신규 후보 `apps/web/src/server/auth/supabase/session-parser.test.ts`: 잘못된 토큰/사용자/만료 응답 사례. 주요 사례는 공개 어댑터를 통과시켜 실제 연결도 검증한다.
- 신규 후보 `apps/web/src/server/auth/supabase/error-mapper.test.ts`: 상태별 오류·계정 존재 노출 방지 시나리오.
- 신규 후보 `apps/web/src/server/auth/supabase/test-fixtures.ts`: 가짜 SDK·토큰·응답 및 어댑터 생성 fixture. 제품 코드에서는 절대 import하지 않는다.
- `apps/web/vitest.config.ts`: 현재 coverage include는 기존 어댑터 파일을 명시하므로 새 제품 모듈도 포함해야 한다. 테스트/fixture만 제외하며 기존 threshold를 낮추지 않는다.
- `apps/web/src/server/auth/auth-provider-port.test.ts`: 기존 공개 메서드 주석·server-only 검사 유지. 공개 파일을 유지하므로 원칙상 읽기 전용 회귀 대상이다.
- `apps/web/src/server/container.ts`: import 경로·생성자 유지 확인용 읽기 전용 대상.
- 결과 문서: `docs/architecture/backend-authentication.ko.md`, `docs/guides/security-auth-testing.md`, `docs/status/2026-08-24-development-progress.ko.md`.

예상 **제품 6파일(기존 1+신규 5), 테스트/fixture 4파일(기존 1+신규 3), 설정 1파일, 결과 문서 3파일 = 14파일**이다. 이 검토 문서와 승인 후 상세 계획은 별도다. 파일 수는 늘지만 책임별로 읽을 양은 줄어든다. 약 500~800줄을 이동·재배치할 수 있어 Git 추가/삭제량은 커질 수 있지만 같은 양의 새 기능을 만드는 것이 아니다. 사업 로직 추가량은 0을 목표로 하며 import/export·주석 정리 등 연결 변경은 발생한다.

## 진행과 검증

1. 승인 후 기능 브랜치에서 기존 관련 테스트와 선택적 coverage의 현재 결과를 먼저 기록한다. 과거 threshold 미달 기록이 있으므로 baseline 상태와 새 회귀를 구분한다.
2. 오류/검증/파싱 분리 → 직접 HTTP/SDK 생성 분리 → 진입점·테스트 정리 순서로 진행한다.
3. 단계마다 기존 동작 테스트를 유지하고 이동 전후 누락을 대조한다. 순수 이동에 인위적인 RED를 만들지 않는다. 미검증 동작이 발견되면 필요한 회귀 테스트만 먼저 보강한다.
4. 전체 `pnpm verify`, 새 파일을 포함한 coverage 측정, 서버전용 경계·타입·순환 의존·공개 import 호환성을 확인한다. 테스트나 측정 대상을 제외해서 통과시키지 않는다.
5. 결과와 기존 미해결 사항을 기록하고 독립 리뷰 후 분리 작업만 별도 커밋 단위로 정리한다. 커밋/푸시는 요청 범위를 확인한다.
6. 분리 완료 후 인증 시간 제한 계획의 변경 파일 지도·규모를 다시 산정하고 별도 승인받는다. 이전 7파일 추정은 분리 전 구조 기준이다.

파일 분리 자체가 보안 기능이나 FCP 개선을 만들어 주지는 않는다. 검증 책임이 명확해져 리뷰·수정·테스트가 쉬워지는 효과를 기대한다. 동적 import나 브라우저 번들 분할은 별도 성능 작업이다.
