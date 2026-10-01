# 소셜 로그인 활성화 전 앱 준비 결과

기준: 2026-09-30, `feature/bank-state-transitions` / HEAD `10ec214`. 기존 회원/원장 DB·API·PC 화면의 미커밋 변경을 보존한 후속이다. 사용자 요청: 앱 측 준비를 먼저 처리하고 외부 소셜 설정은 사용자가 내일 수행한다.

## 반영한 것

- 서버 `AUTH_ENABLED_PROVIDERS` 기본 `[]`, 엄격한 JSON/공급자/중복 검사.
- 공개 `GET /api/auth/providers`: 이름만 반환, DB·키 불필요, no-store. 브라우저 CORS 허용을 추가하지 않음.
- 로그인/가입의 준비 중 버튼, 조회 중/실패 때 비활성, 재조회 중 과거 활성 캐시 무시.
- BFF OAuth start/continue/callback의 서버 허용 목록 검사. 목록 제거는 기존 세션 폐기가 아님.
- 이메일 없는 OAuth에 한정한 비익명·AMR·동일 사용자/공급자 identity 검증. 이메일/비밀번호·메일 확인·복구는 기존 이메일 필수 조건 유지.
- `/v1/me`의 `email:null`과 함께 반환하던 `emailVerified:true`를 false로 정정. API가 이메일 인증 증거를 전달하지 않음을 정확히 표현.
- Git 밖 로컬 web.json의 선택적 설정 지원. 기존 파일은 기본 비활성, 부모 환경값은 활성화 근거로 상속하지 않음.
- 한국어 운영 준비 가이드, 인증 환경/아키텍처 문서, 다음 거래 개발 계획. Playwright CLI artifact도 Git 제외.

새 정책을 작은 별도 파일로 나누고 기존 controller에는 검사 호출만 추가했다. DB migration, 의존성, 실제 provider 키/콘솔 설정, hosted DB 데이터는 변경하지 않았다. 상세 파일 지도는 [실행 계획](../superpowers/plans/2026-09-30-social-auth-readiness.md).

## 검증

| 검사 | 결과 | 의미 |
| --- | --- | --- |
| 변경 전 전체 일반 테스트 | 1,401 통과 | 기존 미커밋 작업의 기준선 |
| 핵심 RED | 12 실패 / 96 통과 | 미구현 허용 목록·비활성 UI·OAuth 정책의 예상 실패 |
| 로컬 실행기 RED→GREEN | 1 실패/6 통과 → 7 통과 | 명시 설정/기본 비활성/부모 환경 불상속 |
| API 이메일 표시 RED | 1 실패/8 통과 후 수정 | false 기대값으로 잘못된 true를 재현 |
| 최종 `pnpm verify` | exit0, 1,443 통과 | lint·6 workspace 타입·전체 테스트·API/웹 build |
| 실제 Playwright core | 3 통과 | 합성 IdP + HTTPS BFF + Nest + 폐기용 PostgreSQL |
| Playwright CLI 준비 화면 | 확인 | 실제 Chromium 로그인/가입·준비 중·오류 상태 |
| `git diff --check` | 통과 | Git CRLF 안내는 별도, whitespace 오류 없음 |
| env/산출물 제외 | 확인 | 추적 env 없음, `.env.local`·output·CLI artifacts ignore |

1,443 = legacy207 + contracts89 + database schema19 + API205 + web837 + E2E preflight86. `database schema19`는 실제 DB 전체 권한 suite가 아니다. 이번 실제 DB 동작은 core Playwright 3개 흐름의 별도 폐기용 DB를 사용했다. 이전 DB 전체 검증 수치를 이번에 재실행한 것으로 합산하지 않는다.

PC core에서는 계좌·카테고리·프로필 생성/수정/보관, 새로고침 후 유지, 동시 수정409, 사용자 재확인과 로그아웃을 확인했다. CLI에서는 실제 기본 공급자 목록 `[]`로 세 버튼 비활성·이메일 입력 가능, 1080/1440/1920 너비 가로 overflow 없음과 1440 스크린샷을 확인했다. 일부 활성화/설정503 응답은 브라우저 네트워크 대역으로 검사했으므로 실제 Google 성공 증거가 아니다. 버튼 시작 실패 후 고정 한국어 안내·버튼 복귀, 설정 실패 시 전부 비활성·원문 오류 미표시를 확인했다. 의도적503은 브라우저 HTTP 오류로 기록되며 숨기거나 정상 성공으로 세지 않는다.

리뷰에서 새 테스트의 세션 인수 기대값 오류와 `/me` 문서 불일치를 찾아 수정했다. stale 활성 캐시·잘못된 subject·익명 JWT·미래 AMR·provider 누락 회귀도 보완했다. 검토한 제품 코드에 확정적인 보안 결함은 보고되지 않았으나 전면 침투 테스트/운영 보안 감사 완료를 뜻하지 않는다.

원시 결과는 Git 제외 `output/social-verify-final.log`, `output/social-core-e2e.log`, `output/playwright/social-sign-up-prepared.png`에 있다. 합성 테스트 전용 서버와 이번에 시작한 PostgreSQL은 검사 후 종료했다. 사용자 운영/개발 인증 서버나 실제 설정을 바꾸지 않았다.

## 미완료·사용자 담당

- Google/Kakao/Naver 개발자 앱·키·동의항목·정확한 콜백·Supabase 활성화.
- Naver `response.id` 중첩 식별자를 Supabase custom provider가 처리하는지 실제 호환성 확인. 단순 callback 등록만으로 완료라고 단정하지 않음.
- 실제 공급자 성공·취소·이메일 미제공·갱신·로그아웃·계정 연결 정책 검증.
- 운영 배포·도메인·실금융 베타 보안 게이트, 은행 실제 연동, 별도 모바일.

소셜 콘솔 설정·실제 계정 생성/메일 발송·원격 DB 변경·유료 서비스 변경·커밋/푸시는 하지 않았다. 기존 큰 미커밋 작업과 이번 작업 모두 보존한다.

## 다음 작업

[거래 조회·입력 계획](../superpowers/plans/2026-09-30-transaction-entry.md)에 변경 파일·API·멱등성·PC 검증 순서를 작성했다. 첫 범위는 `GET/POST /v1/transactions` → BFF → PC 수입/지출 입력·목록이다. 수정/삭제 → 시작 잔액/이체 → 은행 조회/수집 → 모바일은 각각 후속이다. 외부 소셜 활성화를 기다리지 않고 로컬 합성 인증으로 개발할 수 있다. **이 계획의 거래 API/화면은 아직 구현하지 않았다.**

사용자 가이드: [소셜 인증 준비·내일 설정](../guides/social-auth-readiness.ko.md).

Notion 반영: [02. 로그인·가입·복구·소셜 인증](https://app.notion.com/p/3e3323168ba6816a87b9ff42527d84e9)에 최신 체크리스트·검증·현재 user/finance 이름·PC 화면 상태를 반영했다. [13. 웹 거래 목록·분류·상세 메모](https://app.notion.com/p/3e3323168ba681fd8542df4dfd8d2491)에는 실행 순서·예상 규모를 추가하고 구현 상태는 시작 전으로 유지했다. 과거 날짜별 기록은 보존한다.
