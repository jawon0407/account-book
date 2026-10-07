# 소셜 로그인 준비와 내일 할 설정

기준: 2026-09-30. 앱 코드의 준비와 실제 공급자 활성화를 구분한다. 현재 기본값은 세 공급자 모두 비활성이고 이메일 화면은 유지된다. 실제 키·비밀번호·토큰은 이 문서나 Notion에 적지 않는다.

## 누가 무엇을 하나요?

| 담당 | 범위 | 현재 상태 |
| --- | --- | --- |
| 앱 개발 | BFF 시작/콜백, PKCE·state, 암호화 서버 세션, 준비 중 UI, 이메일 없는 OAuth 경계 | 로컬 코드·합성 테스트 연결 |
| 사용자 | Google/Kakao/Naver 개발자 앱·최소 동의항목·키·정확한 콜백 등록, Supabase 공급자 설정 | 내일 수행 예정 |
| 함께 검증 | 실제 로그인·취소·재로그인·갱신·로그아웃 및 사용자 ID 연결 | 외부 설정 후 수행 |

**NestJS에 네이버 Passport만 추가하는 구조가 아니다.** 현재 Google/Kakao는 Supabase 기본 공급자, Naver는 `custom:naver` 경로를 사용한다. Nest API는 앱 요청의 사용자·권한을 검증하고 프로필과 금융 데이터를 처리한다. Naver의 실제 custom 공급자 호환성은 미확정이다.

## 코드 흐름을 쉬운 말로 보면

1. 화면이 ky → React Query로 `/api/auth/providers`를 읽는다. 서버가 허용한 이름만 오며 키·DB 정보는 없다.
2. `AUTH_ENABLED_PROVIDERS`가 없으면 `[]`이므로 버튼에 “준비 중”을 표시한다. 로딩·실패 때도 끈다. 이전에 켜졌던 조회 캐시가 있어도 재확인 중에는 쓰지 않는다.
3. 버튼을 누르면 기존 CSRF 보호 시작 API를 호출하고 같은 출처의 continue 경로로만 이동한다. 시작·계속·콜백에서 서버가 허용 목록을 다시 검사하므로 버튼을 조작해도 우회할 수 없다.
4. BFF는 사용자 브라우저와 연결한 일회용 state, 서버에 암호화한 PKCE 검증값을 사용한다. 콜백은 같은 거래를 한 번만 소비한다.
5. Supabase의 성공 응답을 검증한 뒤 앱 전용 불투명 세션 쿠키를 만든다. 공급자 토큰은 브라우저 저장소에 두지 않는다.

핵심 파일: `server/auth/oauth-configuration.ts`(설정 검사), `server/http/oauth-availability.ts`(공개 상태), `queries/oauth-availability.ts`(조회 상태), `components/auth/provider-buttons.tsx`(표시·이동), `server/auth/supabase/social-identity.ts`(이메일 없는 신원), `server/auth/oauth-service.ts`(콜백·세션 생성). 앞 경로의 루트는 `apps/web/src/`다.

## 이메일이 없어도 괜찮나요?

공급자 고유 사용자 식별자로 인증할 수 있다. 다만 이메일이 비어 있다는 이유만으로 허용하지 않는다. 신뢰된 Supabase 서버 응답의 비익명 표시, `oauth` 인증 방식(AMR), 동일 사용자·기대 공급자의 identity와 비어 있지 않은 `sub`를 모두 확인한다. 편집 가능한 user metadata는 근거로 쓰지 않는다.

통과한 이메일 없는 계정은 `email: null`, `emailVerified: false`다. 가짜 이메일이나 인증 완료 표시를 만들지 않는다. **이메일/비밀번호 로그인·메일 확인·비밀번호 복구는 여전히 검증된 이메일을 요구한다.** 이메일이 있으나 인증되지 않았다면 OAuth 경로에서도 거부한다.

`GET /v1/me`도 이메일을 따로 조회하지 않아 `email: null`, `emailVerified: false`를 반환한다. 이는 로그인 실패가 아니라 “이 API는 이메일 인증 사실을 제공하지 않음”이다. 금융 권한은 인증된 사용자 ID로 판단한다. 실제 공급자 응답 형태가 합성 시험과 다르면 실패를 허용으로 바꾸지 말고 해당 공급자를 끈 상태로 원인을 확인한다.

## 내일의 설정 순서

### 1. 로컬 주소부터 일치시키기

현재 개발용 웹 기준은 `https://localhost:3000`이다. `http`와 `https`, `localhost`와 `127.0.0.1`은 서로 다르다. Supabase Site URL은 실제 실행 주소에 맞추고 Redirect URLs에는 다음 앱 복귀 경로를 정확히 등록한다.

```text
https://localhost:3000/api/auth/callback
https://localhost:3000/api/auth/email/callback
https://localhost:3000/api/auth/password/callback
```

**개발자 사이트에 넣는 콜백은 위 앱 복귀 주소가 아니다.** 개발자 사이트에는 Supabase 공급자 화면의 Callback URL을 복사한다. 흐름은 `공급자 → Supabase callback → 앱 /api/auth/callback`이다. Google/Kakao 기본 callback은 일반적으로 `https://<project-ref>.supabase.co/auth/v1/callback`이지만, 추정값 대신 해당 화면의 값을 사용한다. Naver custom도 자신의 생성 화면 값을 그대로 사용한다.

### 2. Google과 Kakao를 한 개씩 설정하기

- Google: 개발자 앱의 웹 Client ID/Secret·테스터·최소 로그인 범위와 Supabase callback을 설정한 뒤 Supabase Google provider에 입력한다.
- Kakao: REST API 키·로그인 활성화·client secret·최소 동의항목·Supabase callback을 설정하고 Supabase Kakao provider에 입력한다. 이메일을 받지 않는다면 Supabase의 이메일 없는 사용자 허용 설정도 확인한다. 전화번호·생일 등을 우회 수집하지 않는다.
- 비밀값은 각 플랫폼 설정에 직접 입력한다. 코드를 수정하거나 채팅으로 키를 전달할 필요는 없다.

상세 콘솔 절차는 [플랫폼 온보딩 7~9절](platform-and-oauth-onboarding.ko.md#7-google-oauth-app)을 따른다. 앱 키 입력은 공급자 로그인을 가능하게 하는 준비이며 성공·취소·재로그인 검증을 대신하지 않는다.

### 3. Naver는 추가 호환성 확인하기

`custom:naver`의 OAuth2 설정에서 공식 authorization/token/userinfo 엔드포인트와 콜백을 확인한다. 네이버 프로필은 `response.id`에 앱별 고유 식별자를 넣는다. **Supabase custom 설정이 이 중첩 식별자를 정상 매핑하는지는 아직 확인하지 못했다.** 설정 화면과 실제 개발용 응답으로 매핑·이메일 선택·토큰 교환·갱신을 확인해야 한다. 호환되지 않으면 연동 설계를 다시 검토하며 임의 Passport 추가나 이메일로 계정 강제 병합을 하지 않는다.

custom 공급자의 upstream PKCE 설정과 앱 BFF→Supabase PKCE는 서로 다른 구간이다. upstream 미지원이 공식적으로 확인되지 않으면 보안 옵션을 끄지 않는다. 앱 S256 PKCE와 state·브라우저 결속은 계속 유지한다. 이 확인 전 Naver는 “준비 중”으로 둔다.

### 4. 앱 허용 목록 반영 후 검증

검증할 준비가 된 공급자만 서버 설정에 넣고 BFF를 재시작/재배포한다. 이 목록은 외부 서비스를 자동 활성화하지 않는다.

```text
AUTH_ENABLED_PROVIDERS=[]
AUTH_ENABLED_PROVIDERS=["google"]
AUTH_ENABLED_PROVIDERS=["google","kakao"]
```

위 세 줄은 단계별 예시이지 한 파일에 모두 입력하는 설정이 아니다. 로컬 `scripts/local-auth/start.mjs` 실행기는 Git/OneDrive 밖 `%LOCALAPPDATA%/account-book/dev-auth/web.json`의 같은 이름 항목을 사용한다. JSON 파일에서는 문자열값이므로 `"AUTH_ENABLED_PROVIDERS": "[\"google\"]"` 형태다. 기존 파일은 항목 없이도 `[]`로 동작한다. 다른 비밀값을 복사·출력하거나 파일 전체를 공유하지 않는다. API용 파일이나 `NEXT_PUBLIC_*`에는 넣지 않는다.

활성 목록에서 제거하면 **새 소셜 로그인만** 막는다. 기존 세션이나 공급자 계정까지 폐기하지 않는다. 보안 사고 대응은 별도 세션 폐기·키 회전 절차를 따른다. 목록이 잘못된 JSON이거나 지원하지 않는 이름/중복을 포함하면 안전하게 인증을 거부한다.

## 실제 활성화 완료 체크

- [ ] Google/Kakao/Naver 각각 실제 성공과 사용자 취소를 확인한다.
- [ ] 콜백의 state·브라우저 불일치·만료·재사용은 거부한다.
- [ ] 이메일 미제공·동의 거부·미인증 이메일 처리와 서버 identity/AMR를 확인한다(원문 토큰 기록 금지).
- [ ] 같은 공급자로 재로그인했을 때 같은 Auth 사용자와 `user.users` 프로필을 사용한다.
- [ ] 세션 갱신·로그아웃 후 접근 거부를 확인한다.
- [ ] 다른 공급자의 같은 이메일을 임의로 강제 병합하지 않고 계정 연결 정책을 검증한다.
- [ ] 운영 도메인·실제 secret·공개 심사·개인정보 고지는 별도 출시 게이트로 확인한다.

## 공식 근거

- [Supabase custom OAuth](https://supabase.com/docs/guides/auth/custom-oauth-providers): custom 공급자 설정·별도 callback·PKCE·이메일 선택 정책.
- [Supabase JWT fields](https://supabase.com/docs/guides/auth/jwt-fields): OAuth AMR 및 비익명 관련 클레임.
- [Kakao 로그인](https://supabase.com/docs/guides/auth/social-login/auth-kakao): 이메일 없는 사용자 허용과 기본 공급자 설정.
- [Naver 프로필 명세](https://developers.naver.com/docs/login/profile/profile.md): `response.id` 위치와 앱별 고유 식별자.

문서를 근거로 앱 경계를 구현한 것이며 실제 공급자 호환성을 확인했다는 뜻은 아니다.
