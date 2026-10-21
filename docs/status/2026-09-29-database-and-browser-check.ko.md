# DB 테이블 및 Playwright MCP 확인

## 결론: 테이블은 생성되어 있다

2026-09-29 17:02 KST, 승인된 개발 프로젝트 `tjtamaazsilaegvvovhg`의 PostgreSQL 메타데이터를 TLS 연결과 READ ONLY transaction으로 조회했다. 사용자·금융 행은 읽지 않았고 변경 쿼리도 실행하지 않았다.

| 스키마(테이블을 묶는 폴더에 해당) | 실제 확인한 테이블 |
| --- | --- |
| `public` | 0개. 사용자가 보낸 두 화면에서 선택된 스키마 |
| `app_identity` | `profiles`, `user_roles`, `role_change_events` |
| `app_ledger` | `accounts`, `categories`, `transactions`, `transfers`, `idempotency_requests` |
| `app_private` | 세션·OAuth·메일 확인·복구·요청 제한·사용자 보안 상태·JWT 재사용 방지의 7개 서버 전용 테이블 |

`profiles.signup_provider`, `profiles.deleted_at`도 존재한다. identity/ledger 8개 테이블 모두 RLS와 FORCE RLS가 켜져 있다. app_api는 두 스키마의 USAGE 권한이 있고 anon/authenticated/service_role/app_bff_login에는 없다. app_private는 직접 접근 GRANT/서버 전용 함수 경계로 보호하며 금융 테이블과 같은 RLS 정책을 가졌다고 표현하지 않는다.

Supabase Table Editor 또는 Database → Tables의 **schema public** 드롭다운에서 **app_identity / app_ledger**를 선택한다. `auth.users`는 Authentication → Users에서 확인한다. 테이블 확인을 위해 Data API의 Exposed schemas에 이 스키마를 추가하거나 public으로 옮길 필요가 없다. 앱은 브라우저 → Next BFF → Nest API → 최소 권한 DB 경로를 사용한다.

아직 `app_bank` 스키마는 이 개발 DB에 없다. 현재 계좌 목록 테이블이 존재하는 것과 실제 은행 자동 연동이 구현된 것은 별개다.

## Playwright MCP

- 공식 `@playwright/mcp@0.0.83`을 `codex mcp add playwright`로 등록했다. 기존 다른 MCP 설정은 수정하지 않았다.
- Edge, headless, isolated, service worker 차단, WebMCP 비활성. 개인 브라우저 프로필·쿠키를 가져오지 않고 TLS 검증도 끄지 않았다.
- 현재 이미 열린 대화의 도구 목록에는 Playwright 도구가 자동 추가되지 않았다. 대신 등록한 공식 서버와 stdio JSON-RPC로 initialize → tools/list → browser_navigate → screenshot → browser_close를 실제 실행했다.
- `https://localhost:3000/sign-up`의 가입 폼·소셜 버튼·로그인 링크를 스냅샷과 이미지로 확인했다. 해당 접속 콘솔에는 React 개발 안내/HMR 메시지만 있고 오류는 없었다.
- 증거: Git 제외 `output/playwright/mcp-sign-up.png`, `page-2026-09-29T08-05-39-932Z.yml`. 입력·가입·금융 데이터 변경은 하지 않았다.
- 서버 패키지 버전과 도구 initialize의 내부 Playwright 엔진 버전은 별개다. 이 검사는 연결/화면 smoke이지 인증·장부 E2E 완료가 아니다.

## 후속 우선순위

1. 프로필·계좌·카테고리의 Next BFF 연결 및 보안 회귀 검사.
2. 참조 디자인 기반 PC 장부 셸, 프로필·계좌·분류 UI와 ky/React Query 연결.
3. 거래·이체 API 및 입력/분류 UI.
4. 은행 조회·수집 상태 연결, 이후 별도 모바일 앱.

테이블 재생성·원격 migration·권한 확대·Git 커밋/푸시·배포는 이번 점검에서 하지 않았다.
