# 프론트엔드 구조와 인증 요청 따라가기

이 문서는 현재 저장소의 Next.js 화면을 처음 읽는 사람을 위한 안내다. 폴더 이름보다 “사용자가 버튼을 누르면 어느 함수가 무엇을 받는가”를 중심으로 설명한다. 아래 예시의 이메일·비밀번호·경로는 합성 데이터이며 실제 계정으로 실행하라는 뜻이 아니다.

## 1. 지금 구현된 것과 앞으로 구현할 것

현재 PC 웹은 Next.js App Router 기반이다. 좁은 화면에도 대응하지만, 모바일 제품의 최종 계획은 웹을 설치하는 PWA가 아니라 별도의 React Native·Expo 앱이다. 모바일 앱은 아직 구현되지 않았다.

| 구분 | 현재 소스에서 확인할 수 있는 것 | 계획 또는 제외 |
|---|---|---|
| 화면 | 인증 화면, 계좌·분류·닉네임 관리, `/app/transactions` 거래 목록·수입/지출 입력·수정·삭제 확인 | 시작 잔액·이체·대시보드는 후속 |
| HTTP | ky 공통 클라이언트와 같은 출처 `/api` BFF, 사용자별 금융 query/mutation | 은행·이체 화면 연결은 후속 |
| 상태 | TanStack Query와 React 로컬 state/ref | Zustand는 아직 없음. 여러 화면 공통의 비서버 UI 상태가 필요할 때 검토 |
| 모바일 | 웹·모바일이 공유할 계약 설계 | React Native·Expo 및 모바일 인증/화면은 미구현 |
| 저장·오프라인 | 서버 원장을 기준으로 하는 설계, 현재 QueryClient는 메모리 사용 | PWA 설치, manifest, service worker, 영구 금융 캐시, 오프라인 쓰기는 범위에서 제외 |

설계 근거는 [PC 웹·네이티브 모바일 공용 가계부 설계](../superpowers/specs/2026-07-27-web-native-mobile-shared-ledger-design.md)다. 공개 금융 계약 파일이 생겼다고 금융 화면·API 전체가 완성된 것은 아니다.

## 2. 먼저 알아둘 말

- **컴포넌트(component)**: 화면 일부를 만드는 함수. `SignInForm`은 로그인 입력 화면을 만든다.
- **props**: 부모 컴포넌트가 자식에게 주는 입력 객체. 데이터뿐 아니라 `submit` 같은 함수도 전달한다.
- **callback**: 지금 실행하지 않고 나중에 특정 사건이 생겼을 때 호출하는 함수. `onSuccess`는 요청 성공 후 실행된다.
- **훅(hook)**: `useState`, `useMutation`처럼 React 화면에서 상태나 기능을 연결하는 함수다.
- **query / mutation**: 서버 데이터를 읽는 작업 / 서버 상태를 바꾸는 작업. 파일 이름이 `queries/auth.ts`여도 mutation 설정을 함께 담고 있다.
- **Promise / async / await**: 네트워크처럼 나중에 끝날 일을 표현하고 기다리는 문법. `await submit(input)`은 요청 결과가 나올 때까지 후속 처리를 기다린다.
- **스키마(schema)**: 입력·응답 모양을 실행 중 검사하는 규칙. TypeScript 타입만으로 외부 JSON이 안전해지는 것은 아니므로 Zod로 다시 검사한다.
- **BFF**: 브라우저와 내부 서버 사이의 웹 전용 서버. 이 저장소에서는 Next.js의 `/api` 라우트다.
- **same-origin(같은 출처)**: 프로토콜·호스트·포트가 같은 주소. 브라우저는 외부 내부-API 주소 대신 현재 사이트의 `/api`를 호출한다.
- **CSRF 증표**: 다른 사이트가 사용자의 쿠키를 이용해 임의 변경 요청을 보내는 것을 막기 위한 요청 확인값. 공급자 로그인 토큰과는 다르다.

## 3. 폴더와 파일 읽는 순서

모든 소스 링크는 저장소 루트를 기준으로 실제 파일에 연결한다.

| 파일/폴더 | 읽을 이유 |
|---|---|
| [app/layout.tsx](../../apps/web/src/app/layout.tsx) | `RootLayout`이 한국어 HTML과 `Providers`를 감싼다 |
| [app/providers.tsx](../../apps/web/src/app/providers.tsx) | `createQueryClient`와 `Providers`가 한 마운트의 서버 상태 관리자를 공유한다 |
| [app/(auth)/layout.tsx](../../apps/web/src/app/(auth)/layout.tsx) | 인증 화면 공통 main. `(auth)`는 URL에 표시되지 않는다 |
| [로그인 페이지](../../apps/web/src/app/(auth)/login/page.tsx) | `LoginPage`가 UI에 실제 요청·이동 callback을 연결한다 |
| [auth-form.tsx](../../apps/web/src/components/auth/auth-form.tsx) | 입력 검사, 로딩, 포커스, 오류 안내를 담당한다 |
| [auth.ts](../../apps/web/src/queries/auth.ts) | 입력/응답 계약과 query/mutation 함수를 연결한다 |
| [csrf-client.ts](../../apps/web/src/lib/http/csrf-client.ts) | 새 CSRF 증표를 얻어 허용된 POST를 보낸다 |
| [api-client.ts](../../apps/web/src/lib/http/api-client.ts) | ky 설정과 공개 오류 변환 경계다 |
| [로그인 route.ts](../../apps/web/src/app/api/auth/sign-in/route.ts) | POST를 고정 `signIn` 작업으로 넘긴다 |
| [route-adapter.ts](../../apps/web/src/server/http/route-adapter.ts) | 요청별 서버 의존성을 만들고 인증 컨트롤러를 호출한다 |

`"use client"` 파일은 브라우저 상호작용을 사용하는 React 경계다. 반대로 `src/server`는 브라우저 번들로 가져오면 안 되는 서버 코드다. `app/api/**/route.ts`도 화면 컴포넌트가 아니라 서버 HTTP 진입점이다.

## 4. 로그인 버튼에서 성공 응답까지

```text
LoginPage
  → SignInForm → CredentialsForm.handleSubmit(event)
  → signIn.mutateAsync({ email, password })
  → signInMutationOptions의 mutationFn
  → parsedMutation("auth/sign-in", input, 응답스키마, http)
  → postWithCsrf → getCsrfToken → ky GET /api/auth/csrf
  → ky POST /api/auth/sign-in + X-CSRF-Token
  → route.POST(request) → handleAuthRoute("signIn", request)
  → 서버 AuthController.signIn → 인증/세션 처리
  → 검증된 성공 응답 → onSuccess → /app → 현재 사용자 확인 → 본인 계좌 목록
```

### 4.1 화면이 요청 함수를 전달한다

`LoginPage`는 `useMutation(signInMutationOptions())`으로 로그인 실행기를 만든다. `SignInForm`에는 다음 의미의 props를 넘긴다.

```tsx
// 실제 로그인 페이지의 연결 방식이다. 입력값은 아직 전달하지 않고 함수를 전달한다.
<SignInForm
  submit={(input) => signIn.mutateAsync(input)}
  onSuccess={() => window.location.assign("/app")}
/>
```

`submit`은 요청을 실행하는 함수이고, `onSuccess`는 완료 후 화면 이동 함수다. 폼은 어떤 URL을 호출하는지 몰라도 검증·로딩·안내를 처리할 수 있다.

### 4.2 폼이 입력을 읽고 먼저 검사한다

`CredentialsForm.handleSubmit(event)`는 다음 순서로 작동한다.

1. `event.preventDefault()`로 브라우저의 기본 폼 이동을 막는다.
2. 이미 진행 중이면 이번 제출을 무시한다.
3. `new FormData(event.currentTarget)`로 현재 폼의 email/password를 읽는다.
4. `schema.safeParse`로 검사한다. 잘못된 입력이면 서버 요청 없이 오류 문구와 첫 오류 필드 포커스를 설정한다.
5. 올바르면 pending 상태를 표시하고 `await submit(parsed.data)`를 실행한다.
6. 성공이면 success 상태와 `onSuccess`를 실행한다. 실패이면 `safeErrorMessage`로 공개 코드에 대응하는 고정 한국어 안내를 표시한다.

예를 들어 합성 입력 `{ email: "learner@example.test", password: "demo-only-password" }`는 두 문자열을 가진 객체다. 비밀번호 길이는 현재 계약상 12~1024자다. 이 예시가 실제 서버에 등록된 계정이라는 뜻은 아니다.

입력값 자체는 제출 시 DOM에서 읽는다. `useState`는 오류·진행 안내를 관리하고, `useRef`는 오류 입력에 포커스를 옮기는 데 사용한다.

### 4.3 query 계층이 요청·응답 계약을 확인한다

`signInMutationOptions(http)`는 설정을 만들 뿐 즉시 로그인하지 않는다. 나중에 `mutationFn(input)`이 실행되면 `SignInInputSchema.parse(input)`으로 입력을 검사하고 `parsedMutation`을 호출한다.

성공 응답은 `user`, `expiresAt`, `absoluteExpiresAt`을 가진 엄격한 객체다. 사용자 객체는 `CurrentUserSchema`로 검증하며 공급자 access/refresh token을 응답 필드로 받지 않는다. 잘못된 응답·HTTP 실패는 `apiError`를 거쳐 공개 오류로 바뀐다. 입력 `parse` 실패는 요청 전 Zod 오류이며 폼에서는 일반 안전 문구로 처리한다.

### 4.4 HTTP 계층이 증표와 POST를 보낸다

`postWithCsrf("auth/sign-in", input, http)`는 먼저 경로가 허용 목록인지 확인한다. 그다음 `getCsrfToken`으로 증표를 받아 `X-CSRF-Token` 헤더에 붙여 POST한다. `auth/password/update`만 `context=interaction`을 요청한다.

공통 ky 설정은 `prefix: "/api"`, `credentials: "same-origin"`, `retry.limit: 0`, `timeout: 10_000`이다. 따라서 상대 경로 `auth/sign-in`은 같은 출처 BFF로 보내지고, 자동 재시도는 없으며 요청 제한시간은 10초다. CSRF 조회와 로그인 POST는 서로 다른 두 요청이므로 전체 로그인 과정의 제한시간이 하나의 10초라는 뜻은 아니다.

증표는 해당 호출 중 변수에 보관한다. 브라우저 자바스크립트가 서버의 HttpOnly 세션 쿠키 내용을 읽어 로그인 토큰으로 직접 관리하지 않는다.

### 4.5 BFF가 서버 인증 계층에 위임한다

`app/api/auth/sign-in/route.ts`의 `POST(request)`는 `handleAuthRoute("signIn", request)`를 호출한다. 작업 이름은 요청 본문에서 고르지 않고 파일에 고정되어 있다. 어댑터는 요청별 컨테이너를 만들고 `authController`의 해당 메서드로 요청을 넘긴다.

입력·Origin·CSRF·인증·세션 처리는 서버 계층의 책임이다. UI에서 검사했어도 서버가 다시 검증해야 한다. 브라우저가 금융 테이블이나 서비스 자격증명에 직접 접근하지 않는다.

성공 후 `LoginPage`는 `window.location.assign("/app")`를 호출한다. 2026-09-30부터 `/app`은 사용자별 인증 경계를 거쳐 본인 계좌를 관리한다. [장부 코드 흐름](../guides/core-web-development.ko.md)에서 ky·React Query·CSRF·계정 전환 차단을 확인한다. 계좌 관리 구현은 거래·은행·모바일까지 완성됐다는 뜻이 아니다.

## 5. 현재 사용자 조회와 딱 한 번의 갱신

`useCurrentUser()`는 `currentUserQueryOptions()`를 사용하며 키는 `["auth", "current-user"]`다. 이 훅이 정의되어 있다는 것과 현재 다섯 인증 페이지가 모두 이를 호출한다는 것은 다르다. 현재 페이지 코드는 주로 mutation을 연결한다.

`getCurrentUser(http)`는 내부 `currentUser(http, false)`로 시작한다.

- `GET /api/me`가 성공하면 검증된 사용자를 반환한다.
- 공개 오류 코드가 `AUTH_SESSION_REFRESH_REQUIRED`이고 아직 갱신하지 않았으면 CSRF 보호 `POST /api/auth/session/refresh`를 한 번 호출한다.
- 그 뒤 `currentUser(http, true)`로 원래 조회를 한 번 다시 한다.
- 갱신 후 다시 실패하거나 만료·CSRF·잘못된 자격증명 오류이면 오류를 전달한다. 무한 갱신하지 않는다.

TanStack Query와 ky의 일반 자동 재시도는 꺼져 있다. 위 갱신은 라이브러리 재시도가 아니라 코드에 명시된 인증 흐름이다.

## 6. 다른 인증 화면과 OAuth

| 화면 | 페이지 함수 → 폼/버튼 | 성공 뒤 동작 |
|---|---|---|
| `/login` | `LoginPage` → `SignInForm` / `ProviderButtons` | 이메일 로그인은 `/app` 이동 |
| `/sign-up` | `SignUpPage` → `SignUpForm` / `ProviderButtons` | 이메일 가입 수락 시 `/verify-email` 이동 |
| `/verify-email` | `VerifyEmailPage` → `AuthStatus` | 안내만 표시. 여기서 메일을 발송하거나 인증 여부를 조회하지 않음 |
| `/forgot-password` | `ForgotPasswordPage` → `PasswordResetRequestForm` | 비로그인 공개 요청. 사용자 승인 정책에 따라 미가입은 404 오류, 접수는 발송 요청 안내 |
| `/forgot-password/invalid-link` | `InvalidRecoveryLinkPage` | 만료·실패 복구 링크의 공개 안내와 재요청 이동. 로그인 불필요 |
| `/reset-password` | `ResetPasswordPage` → `PasswordUpdateForm` | 비밀번호 변경 후 `/login` 이동 |

OAuth는 외부 계정으로 로그인하는 절차다. `ProviderButtons.begin(provider, label)`은 전체 공급자 버튼을 진행 상태로 잠그고 `start(provider)`를 기다린다. query 계층과 버튼 양쪽에서 계속 경로를 확인한다.

예시 입력은 `{ provider: "google", returnPath: "/app" }`이고, 기대 응답은 `{ authorizationPath: "/api/auth/oauth/google/continue?returnPath=%2Fapp" }`이다. `%2F`는 URL에 넣기 위해 인코딩한 `/`다.

브라우저는 공급자 URL을 JSON으로 받지 않는다. 먼저 검증된 BFF 계속 경로로 문서 이동하고, 서버가 공급자 인증 화면으로 리다이렉트한다. query 입력 타입은 `/settings/security`도 허용하지만 현재 버튼 UI는 `/app`만 사용하며 설정 화면 구현을 뜻하지 않는다.

## 7. BFF 라우트 참조

아래 표는 기존 인증 라우트 14개를 설명한다. 별도로 준비 상태를 알려 주는 `GET /api/auth/providers`와 장부 라우트 8개(12작업)가 있다. 장부 거래 경로는 `GET/POST /api/transactions`다. `[provider]`는 동적 경로 한 개를 뜻하며 google/kakao/naver별 파일 세 개가 아니다.

| HTTP 메서드·경로 | 어댑터에 고정 전달하는 작업 |
|---|---|
| GET `/api/auth/csrf` | `csrf` |
| POST `/api/auth/sign-up` | `signUp` |
| POST `/api/auth/sign-in` | `signIn` |
| GET `/api/auth/email/callback` | `emailCallback` |
| POST `/api/auth/oauth/[provider]/start` | `oauthStart` |
| GET `/api/auth/oauth/[provider]/continue` | `oauthContinue` |
| GET `/api/auth/callback` | `oauthCallback` |
| GET `/api/auth/session` | `session` |
| POST `/api/auth/session/refresh` | `refresh` |
| POST `/api/auth/sign-out` | `signOut` |
| POST `/api/auth/password/reset-request` | `passwordResetRequest` |
| GET `/api/auth/password/callback` | `passwordCallback` |
| POST `/api/auth/password/update` | `passwordUpdate` |
| GET `/api/me` | `me` |

각 모듈은 Node.js runtime, `force-dynamic`, `maxDuration: 10`을 선언한다. 함수 실행 지역은 각 route가 아니라 [웹 배포 설정](../../apps/web/vercel.json)의 `regions: ["iad1"]`로 통합한다. 향후 Vercel Root Directory는 `apps/web`이며 실제 프로젝트는 아직 생성하지 않았다. 지원하지 않는 HTTP 메서드는 `unsupportedAuthRoute`를 재수출해 405로 처리한다. 인증 처리 예외는 어댑터에서 안전한 503 응답으로 바뀐다.

설정 파일 통합은 서버 실행 위치를 지정하는 입력을 한 곳에서 관리하기 위한 변경이다. 인증 함수의 매개변수나 응답, 쿠키·CSRF·JWT·DB 권한은 바뀌지 않는다. `route-wiring.test.ts`는 배포 설정 JSON과 기존 어댑터/HTTP 정책을 검사하며, Vercel 실제 실행 지역까지 증명하지는 않는다. 배포 후 확인 방법은 [플랫폼 안내](../guides/platform-and-oauth-onboarding.ko.md#42-리전-설정의-의미와-배포-확인)를 참고한다.

동적 라우트의 `context`는 `{ params: Promise<{ provider: string }> }` 형태다. 예를 들어 Next.js가 google 경로를 선택했다면 params를 기다린 결과는 `{ provider: "google" }`다. TypeScript의 string 선언만으로 공급자가 허용된 것은 아니며 서버가 별도로 검사한다.

## 8. 상태·오류·접근성 읽기

`createQueryClient`는 메모리 상태 관리자 한 개를 생성한다. `Providers`는 `useState(createQueryClient)`로 마운트 동안 같은 인스턴스를 사용한다. 영구 저장 연결이나 Zustand 저장소는 만들지 않는다.

“영구 저장하지 않는다”와 “메모리에 절대 남지 않는다”는 다르다. TanStack mutation에는 입력 variables 등이 메모리에 남을 수 있으므로 비밀번호·토큰이 메모리에 전혀 없다고 설명하면 안 된다. `signOutMutationOptions` 자체는 로그아웃 요청 설정이다. 금융 화면의 `LedgerAuthBoundary`는 사용자별 QueryClient를 사용하며, 세션 재확인/변경/로그아웃 시 기존 화면·폼을 숨기고 금융 캐시를 폐기한다. [거래 개발 흐름](../guides/transaction-development.ko.md)에서 현재 연결을 확인한다.

`apiError(error)`는 공개 오류 봉투를 확인한다. `safeErrorMessage(error)`는 그중 허용된 code만 한국어로 바꾼다. 원본 공급자 메시지, 응답 본문, requestId를 화면에 그대로 표시하지 않는다. `AuthStatus`는 오류를 alert, 성공·진행을 status로 읽히게 하고, 폼은 오류 입력을 aria 속성과 포커스로 연결한다.

## 9. 실행하지 않고 코드로 확인할 지점

이 문서 작성은 설명·주석 작업이며 기능 구현이나 테스트 통과 보고가 아니다. 의도한 동작은 다음 기존 테스트 파일에서 읽을 수 있다.

- [auth.test.ts](../../apps/web/src/queries/auth.test.ts): 갱신이 필요한 경우에만 한 번 갱신, 자동 재시도 금지, OAuth 계속 경로 검증.
- [csrf-client.test.ts](../../apps/web/src/lib/http/csrf-client.test.ts): 요청마다 새 증표, 비밀번호 변경의 interaction 문맥.
- [auth-ui.test.tsx](../../apps/web/src/components/auth/auth-ui.test.tsx): 잘못된 입력 차단, 포커스, 안전한 오류 안내, 진행 중 공급자 버튼 잠금.
- [route-wiring.test.ts](../../apps/web/src/app/api/route-wiring.test.ts): 얇은 라우트 연결, 실행 정책, 미지원 메서드 거부.

실행 환경을 준비할 때는 [인증 환경 가이드](../guides/auth-environment.md)와 [웹 README](../../apps/web/README.md)를 먼저 읽는다. 실제 공급자 자격증명이나 금융 데이터를 문서·콘솔·테스트 예시에 복사하지 않는다.
