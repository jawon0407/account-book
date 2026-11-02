# Android 착수 전 인증·원장 검증 기록

기준: 2026-10-16, 기능 작업 트리 `ledger-public-contracts`, 브랜치 `feature/bank-state-transitions`, HEAD `8af7a0d` 이후 미커밋 변경. 원격 main이나 배포된 서비스의 완료 보고가 아니다.

[Notion 07 진행 기록](https://app.notion.com/p/3e2323168ba681b59204c2342edb27b3)에도 이번 결과·남은 경계·다음 작업을 반영하고 읽기 확인했다.

## 이번 결과의 의미

Android를 먼저 구현·검증하고 iOS는 그 이후 진행한다. PC는 같은 장부의 조회·편집과 계좌·카테고리·규칙 관리 역할을 유지한다. 이번 작업은 Android 앱을 붙이기 전 공통 기반의 결함과 검증 공백을 보완한 것이다. **현재 `apps/mobile`과 Android 알림 수집기는 아직 없다.**

계좌·카테고리가 미지정인 일반 입출금과 거래 상대명은 [앞선 원장 단위](../superpowers/plans/2026-10-15-ledger-unassigned-foundation.md)에서 로컬 구현했다. 실제 DB에는 이 migration을 적용하지 않았다. 기존 은행 A5 관련 미커밋 변경은 보존하며 현재 개인 알림 장부의 필수 작업으로 확대하지 않는다.

## 무엇을 발견하고 수정했나

### 1. 거절한 로그아웃 요청이 쿠키를 지우던 문제

`apps/web/src/server/http/auth-controller.ts`의 로그아웃은 요청 검증에 실패해도 오류 응답에 쿠키 삭제 헤더를 붙였다. 외부 출처·잘못된 CSRF 요청을 거부하면서 브라우저 로그인 상태에는 부작용을 주는 구조였다. 세션 탈취가 확인된 것은 아니다.

수정 후 처리 순서:

1. 요청 출처, 요청 형식, CSRF, 세션 쿠키를 검증한다.
2. 검증 실패는 오류 응답만 반환한다. 쿠키·서버 세션·인증 공급자는 건드리지 않는다.
3. 검증 성공 뒤 서버 세션을 확인하고 로컬 세션을 먼저 폐기한다.
4. 인증 공급자의 로그아웃이 실패하면 폐기 재처리 상태를 남긴다. 정상 요청에 대한 브라우저 쿠키 정리는 유지한다.

초급 개발자 관점에서 `Set-Cookie`도 상태 변경이다. HTTP 403을 반환했다는 이유만으로 부작용이 없는 것은 아니므로, 응답 헤더와 서버 호출 여부까지 테스트해야 한다.

### 2. 인증 분기 커버리지 부족

기존 1,037개 웹 테스트가 통과해도 선택된 인증/보안 파일의 분기는 836/839(99.64%)여서 기존 100% 게이트에 미달했다. 잘못된 공급자 값, 잘못된 사용자 응답, 잘못된 OAuth DB 행을 거부하는 사례를 추가했다. 측정 파일이나 임계값은 줄이지 않았다.

최종 웹 테스트 1,058개가 통과했고 선택된 19개 인증/보안 파일의 분기는 839/839(100%)다. **프로젝트 전체 코드 커버리지 100%라는 뜻이 아니다.** 로그아웃 컨트롤러의 새 테스트는 별도로 존재하며 이 선택형 커버리지 수치와 혼동하지 않는다.

### 3. 알려진 의존성 취약 버전

| 패키지 | 변경 | 이번 저장소에서 확인한 범위 |
| --- | --- | --- |
| Next | 16.3.6 → 16.3.8 | 운영 패키지. 이미지 remotePatterns가 없어 해당 SSRF의 현재 실행 조건은 확인하지 못함 |
| source-map-js | 1.2.1 → 1.2.2 | 소스맵 처리/빌드 의존 경로. 외부 공격자가 소스맵을 주입하는 실제 경로를 확인한 것은 아님 |
| undici | 7.29.0 → 7.29.1 | jsdom을 통한 개발/테스트 의존성 |
| brace-expansion | 5.0.9 → 5.0.12 | ESLint/minimatch 등을 통한 개발 의존성 |

개발 도구 감사에서 남았던 13건(high 4, moderate 6, low 3)은 마지막 두 패키지의 공지였다. 한정 override와 pnpm 생성 lockfile을 사용했으며 전체 패키지 일괄 업데이트는 하지 않았다. 새 설치 스크립트 허용도 추가하지 않았다.

패치 후 전체 감사와 운영 감사 모두 알려진 취약점 0건이다. 공지·의존성 그래프 기준이며 미공개 취약점이나 애플리케이션 보안 결함이 없다는 보증은 아니다. npm 패키지 undici 패치가 Node 실행 파일에 내장된 HTTP 구현까지 바꾼다는 뜻도 아니다.

공식 근거: [Next 공지](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), [source-map-js 공지](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [undici 유지보수자 공지](https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3), [brace-expansion 유지보수자 공지](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr).

## 변경 파일과 규모

제품 동작 수정은 인증 컨트롤러 1개다. 테스트·의존성까지 포함한 이 보완 단위는 제품/검증/설정 파일 10개와 문서 3개다. 기존 원장 및 은행 A5 변경은 이 숫자에 섞지 않는다.

| 파일 | 역할 |
| --- | --- |
| `apps/web/src/server/http/auth-controller.ts` | 거절된 로그아웃의 쿠키 변경 차단 |
| `apps/web/src/server/http/auth-controller.test.ts` | 거절 4종·정상 검증 이후 실패의 정리 동작 |
| `apps/web/src/server/auth/supabase-auth-adapter.test.ts` | 잘못된 공급자 입력 거부 |
| `apps/web/src/server/auth/supabase/session-parser.test.ts` | 사용자 ID/이메일 형식 거부 |
| `apps/web/src/server/persistence/postgres-auth-transactions.test.ts` | 잘못된 DB 행 반환 차단 |
| `tests/e2e/core/auth-corrections.spec.ts` | 잘못된 CSRF 로그아웃 후 실제 브라우저 세션 유지 |
| `apps/web/package.json` | Next 패치 버전 |
| `pnpm-workspace.yaml` | 검토한 간접 의존성 버전 강제 |
| `pnpm-lock.yaml` | 실제 설치할 패키지와 무결성 고정 |
| `scripts/workspace-policy.test.mjs` | 취약 버전 재유입과 정책 변경 검출 |

문서는 [실행 계획](../superpowers/plans/2026-10-16-auth-audit-remediation.md), 이 기록, [인증 테스트 가이드](../guides/security-auth-testing.md)다. `next-env.d.ts`의 기존 생성 변경과 다른 미커밋 파일을 이 인증 수정의 수작업 결과로 세지 않는다.

## 실행한 검증

환경: Node 22.15.1, pnpm 11.9.0, 로컬 합성 인증 공급자, 폐기용 루프백 PostgreSQL. 실제 이메일·토큰·금융정보나 hosted DB를 시험 데이터로 사용하지 않았다.

| 검사 | 결과 |
| --- | --- |
| 정책 집중 테스트 | 5/5 통과, 종료 0 |
| `pnpm verify` 최종 재실행 | 종료 0. lint·6 workspace 타입·1,746 tests·API/웹 production build 통과 |
| 웹 `test:coverage` | 63파일·1,058개 통과, 종료 0 |
| 선택형 인증 커버리지 | branches 839/839, statements 902/905, functions 198/199, lines 730/732 |
| `pnpm test:db` | 실제 폐기용 PostgreSQL 26파일·306개 통과, 종료 0 |
| core PC Playwright | 15개 통과, 종료 0 |
| 전체/운영 `pnpm audit --json` | 각각 알려진 취약점 0건, 종료 0 |
| 작업 트리 비밀 패턴 검사 | 문서 추가 후 724개 파일, 지원 패턴 탐지 0건 |
| `git diff --check` | 종료 0. CRLF 정규화 안내는 공백 오류와 구별 |

DB·core 브라우저 시험은 Next/source-map-js 패치 후, 마지막 개발 도구 패치 전에 실행했다. 개발 도구 패치 후에는 웹 커버리지·전체 검증·의존성 감사를 다시 실행해 통과를 확인했다. DB 구조나 제품 코드는 그 사이 바뀌지 않았다. 검사 횟수를 합산해 기능 커버리지처럼 표현하지 않는다.

최종 `verify` 테스트 구성은 legacy/security 208 + contracts 96 + database 단위 19 + API 279 + web 1,058 + E2E preflight 86 = 1,746개다. 별도 DB 통합 306개와 실제 core 브라우저 15개는 이 합계 밖이다. Next 16.3.8 production build의 정적 페이지 13개 생성까지 확인했다.

### 실제 브라우저에서 직접 확인한 경로

Playwright MCP로 1440×900 및 1080×900 Chromium에서 합성 계정만 사용했다.

- 빈 로그인 제출의 오류·이메일 포커스.
- 로그아웃 상태의 비밀번호 찾기 진입, 없는 합성 계정의 오류 안내.
- 로그인 → 계좌 추가 → 0원 계좌 행 표시.
- 거래 빈 목록, 시작일이 종료일보다 늦은 검색의 오류, 검색 초기화.
- 1080px 화면에서 가로 넘침 없음.
- 정상 로그아웃 안내, 이미 가입한 이메일의 가입 거절과 로그인 이동.
- 자동 E2E에서 잘못된 CSRF의 로그아웃 거절 후 쿠키 존재·새로고침 후 인증 화면 유지, 정상 로그아웃 뒤 접근 차단.

직접 조작 중 예상된 404(없는 계정)·409(중복 가입) 외의 JS 오류는 관측하지 않았다. 확인한 경로에서 추가 제품 결함을 찾지 못했다는 뜻이지 전체 앱에 버그가 없다는 뜻이 아니다.

로컬 스크린샷은 Git 제외 경로 `output/qa/auth-recovery-missing-account.png`, `output/qa/transactions-empty-desktop.png`, `output/qa/duplicate-signup-desktop.png`에 있다. 자동 E2E의 세션 유지 이미지는 `tests/e2e/output/playwright/rejected-logout-session-preserved.png`다. 실제 사용자 자료가 아니다.

### 실패와 수정 이력

- 로그아웃 거절 테스트 4개가 먼저 실패했고, 요청 검증과 쿠키 정리를 분리한 뒤 통과했다. 유효 요청의 오류 사례를 추가하면서 기존 503 계약을 401로 잘못 기대한 테스트도 바로잡았다. 이것을 제품 버그로 세지 않는다.
- Next/source-map-js 정책은 패치 전 3실패/1통과를 확인했다.
- 개발 도구 정책은 패치 전 2실패/3통과를 확인했다. 패치 뒤 독립 리뷰에서 정상 override 선택자까지 취약 설치로 오인하는 새 테스트 결함을 발견했다. 해당 상태의 전체 verify는 legacy 207통과/1실패로 종료 1이었다. 검사 범위를 `packages`·`snapshots`로 제한한 뒤 집중 테스트 5/5와 최종 전체 verify 종료 0을 확인했다.
- 독립 리뷰에서 로그아웃 수정의 추가 차단 결함은 없었다. 의존성 재리뷰에서도 override 오탐 해결과 범위 밖 lockfile 변경 없음, 추가 차단 결함 없음을 확인했다. 재리뷰어의 읽기 전용 집중 테스트 3/3도 통과했다. 이 범위의 리뷰이며 전체 PR 승인과 다르다.

## PR·운영 검증과 구별할 것

[PR #22](https://github.com/jawon0407/account-book/pull/22)는 열린 상태이며 확인한 원격 head는 `264a7f6dff61622f52fadcc45feaaa69901313ca`다. 확인한 CI 실행 `37590605337`, `37590600001`은 인증 분기 커버리지 단계에서 실패했다. 로컬 개선으로 이 원격 실행의 결과가 바뀌지는 않는다. 새 커밋·푸시·원격 CI 성공·PR 병합·배포를 이번에 수행하지 않았다.

검토는 인증/원장 변경 경계, 의존성, CI 실패 원인 중심이다. 330개 파일의 전체 PR을 모두 검토하거나 실제 서비스 침투 시험을 마친 것으로 표현하지 않는다. `autoplan` 필수 참조와 `qa-only` 보고 템플릿 일부가 설치본에 없었고 gstack browse는 `server.ts` 누락으로 실행되지 않아 Playwright로 대체했다. 전체 자동 리뷰 파이프라인 완료가 아니다.

실제 OAuth 앱·메일 전달, hosted DB 권한/이관, Android 권한·백그라운드·재부팅, 실제 금융 알림 형식, 한국망 FCP/p95, iOS는 미검증이다. 보안 스캔은 등록된 비밀 패턴에 한정된다.

## 다음 구현 순서

1. **모바일 인증·기기·채널 계약과 테스트:** 기존 BFF 서명키를 앱에 넣지 않는다. 세션 갱신/철회, 복수 로그인, 계정당 수집 1대, 기기 교체 뒤 늦은 쓰기 차단, PC 신규 작성 제한을 서버에서 강제한다. `packages/contracts`, API 인증/세션 모듈, DB 추가형 이관, 웹 권한 경계가 예상 영향이다. 상세 파일 수는 해당 코드를 조사한 뒤 확정한다.
2. **Android 기본 앱:** React Native/Expo와 네이티브 모듈 경계로 `apps/mobile`을 추가한다. 로그인·계좌/카테고리 관리·수기 입력·기본 조회부터 실제 API에 연결한다. 버전 호환·개발 빌드 설정과 Bookify 디자인 근거를 먼저 확인한다.
3. **알림 한 형식의 종단 검증:** 명시적 알림 접근 동의 → 허용 출처만 메모리 판독 → 미분류 거래 → 사용자 분류 → PC 조회. 사용자 실제 금융 원문을 공개 fixture나 로그에 남기지 않는다.
4. **범위 확장:** 승인된 중복·실패·선택형 규칙·다중 필터·이체/환불·복구·집계를 단위별로 추가한다. Android 승인 범위와 실기기 검증 완료 후 iOS를 시작한다.

PC의 기존 ‘거래 추가’와 ‘은행 연결’ 메뉴/은행 자동수집 안내는 아직 이전 구조다. 새 채널 권한 및 알림 중심 UX 단위에서 함께 정리해야 한다. 이번 QA에서 해당 메뉴를 제거한 것은 아니다.

로컬 표준 경로/PATH 확인에서 Android SDK·Android Studio·Java·adb·Gradle을 확인하지 못했다. 다른 경로에 설치되어 있을 가능성을 배제하지 않는다. 개발환경 확인/구축과 실제 Android 기기 권한 조작은 별도 검증 단계이며, 화면 틀이나 합성 시험만으로 실기기 완료를 표시하지 않는다.
