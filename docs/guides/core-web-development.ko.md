# PC 장부 화면의 코드와 데이터 흐름

기준: 2026-09-30. 현재 구현은 계좌·카테고리 관리와 닉네임 수정이다. 거래 입력·은행 연결·별도 모바일 앱까지 완성됐다는 뜻은 아니다. 먼저 [화면 사용 방법](core-web-usage.ko.md), 결과는 [검증 기록](../status/2026-09-30-core-web.ko.md)을 읽는다.

## 1. 버튼 하나가 DB에 도착하기까지

```text
계좌 추가 버튼
  → ResourceForm: 이름·종류 검사, 같은 생성 의도에 같은 UUID 키
  → ResourceDialog: create/update/archive 중 고정 동작 선택
  → 계정별 ky: CSRF 조회 → 같은 출처 /api/accounts 호출
  → Next CoreController: 쿠키·사용자 일치·CSRF·입력 검사
  → 서버 간 서명 요청 → Nest API: 권한·중복·버전 검사
  → PostgreSQL finance.accounts에 저장
  → 응답 계약 검사 → 저장 성공 → 목록 다시 조회
```

브라우저는 DB에 직접 연결하지 않는다. `user.users`는 앱 프로필이며, 로그인용 `auth.users`와 다르다. 닉네임은 `/api/profile`을 통해 수정하고 회원 권한은 화면에서 수정하지 못한다. DB 역할·RLS 설명은 [기본 스키마](../database/core-schema.ko.md), 서버 경로는 [BFF 가이드](core-bff-development.ko.md)를 참고한다.

## 2. 파일을 나눈 이유

아래 경로는 `apps/web/src/` 기준이다. 한 컴포넌트에 API·폼·캐시·표를 몰아넣지 않았다.

| 파일 | 역할과 주요 입력 |
| --- | --- |
| `app/app/layout.tsx` | 경로별 화면(children)을 인증 경계 안에 배치 |
| `features/ledger/session.tsx` | `/api/me` 확인, `useLedgerUser()`와 `useLedgerApi()` 제공, 로그아웃 |
| `session-cache.ts`, `private-client.ts` | 사용자별 QueryClient 생성·정리, 인증 오류 때 화면 차단 |
| `api.ts` | 고정 URL·CSRF·Zod 계약 검사. `createLedgerApi(http?, expectedUserId?)`로 전송 경계 생성 |
| `query-options.ts` | 사용자 ID·리소스·보관 필터별 조회 키와 취소 신호 연결 |
| `resource-page.tsx` | `resource: accounts 또는 categories`를 받아 목록·필터·선택 상태 관리 |
| `resource-dialog.tsx` | 선택 항목의 스냅샷과 저장 동작 연결. 읽었던 version 유지 |
| `resource-form.tsx` | 이름·종류·정렬 입력과 저장 중 중복 제출 차단. 저장 결과 불명 시 입력 유지 |
| `form-intent.ts` | `keyFor(payload)`로 같은 정규화 입력의 재시도에 같은 UUID 제공 |
| `profile-page.tsx` | 닉네임 수정, 가입 경로·역할 읽기 전용 표시 |
| `dialog.tsx` | 기본 HTML dialog의 포커스 제한, Escape 닫기, 원래 버튼으로 포커스 복귀 |
| `shell.tsx`, `feedback.tsx`, `ledger.module.css` | 메뉴·틀, 안전한 한국어 안내, 장부에만 적용되는 스타일 |

`http`는 ky 인스턴스이며 테스트에서는 네트워크 경계만 바꾼다. 실제 화면은 항상 확인한 사용자 ID로 만든 클라이언트를 쓴다. `expectedUserId`는 인증 토큰이 아니라 **이 화면을 열었던 사용자와 쿠키 사용자가 같은지** 확인할 추가 조건이다.

`resourceQuery(userId, resource, includeArchived, api)`와 `profileQuery(userId, api)`는 Query 설정을 반환한다. 조회의 `AbortSignal`은 화면 이탈 시 진행 요청을 취소하는 신호다. 변경 요청을 취소했다고 이미 서버에 저장된 작업이 되돌아가는 것은 아니다.

## 3. 세 가지 ID/버전은 목적이 다르다

- 레코드 `id`: 저장된 계좌나 카테고리 자체의 이름표다.
- `idempotencyKey`: 한 번의 **생성 요청 의도**의 이름표다. 저장은 됐는데 응답이 끊겨 다시 누르는 경우 중복 생성을 막는다. 같은 폼·같은 입력에는 같은 키를 쓰며, 입력을 바꾸면 새 키를 만든다. 새로고침·폼 닫기 이후에는 유지하지 않으므로 결과가 불명확하면 먼저 목록을 확인한다.
- `expectedVersion`: 편집을 시작했을 때 읽었던 버전 번호다. 다른 화면이 먼저 저장하면 서버가 409 충돌을 반환한다. UI는 강제 덮어쓰기나 자동 변경 재시도를 하지 않는다.

닉네임은 입력을 시작한 시점의 버전을 따로 보관한다. 편집 중 조회 결과가 바뀌어도 새 버전을 몰래 붙여 이전 입력을 덮어쓰지 않는다. 저장 성공 응답이 로그아웃/화면 이탈 뒤 도착하면 이전 프로필 캐시를 다시 생성하지 않는다.

## 4. 금융 정보를 기기에 남기지 않는 경계

서버 상태는 React Query의 메모리에만 두고 사용자마다 QueryClient를 나눈다. localStorage, sessionStorage, IndexedDB, 서비스워커, 오프라인 저장을 추가하지 않았다. HTTP 조회와 응답에는 no-store를 적용한다. 브라우저·운영체제 전체의 메모리/디스크 흔적까지 완전 삭제한다는 보장은 아니다.

탭으로 돌아오거나 네트워크가 다시 연결되면 바깥 인증 조회부터 확인한다. 확인 중에는 이전 화면·폼을 닫고 사설 캐시를 정리한다. **같은 사용자여도 저장 전 입력이 사라질 수 있다는 사용성 비용**이 있다. 안전한 초안 유지가 필요해지면 신원 확인 완료 후 같은 계정에만 복구하는 별도 설계가 필요하다.

탭 A 화면을 연 뒤 탭 B에서 다른 계정으로 로그인할 수 있다. 그래서 모든 장부 요청에 `X-Account-Book-User`를 붙이고 BFF가 실제 쿠키 세션과 비교한다. 다르면 Nest 호출 전에 401이다. 헤더가 사용자나 권한을 결정하지 않으며 CSRF·서버 권한·RLS를 대체하지 않는다. 기존 비브라우저 소비자 호환을 위해 BFF에서 이 헤더는 선택 조건이고, 이번 웹 UI에서는 항상 전송한다.

로그아웃을 누르면 먼저 화면을 잠근 뒤 캐시를 지운다. 서버 로그아웃에 실패하면 완료라고 표시하지 않고 재시도를 안내한다. 프로필·계좌 응답에서 세션 만료가 확인돼도 화면을 잠근다. 뒤로 가기 메모리 복원(pageshow persisted)은 새로고침해 인증을 다시 확인한다.

## 5. 구현 중 선택한 단순한 구조

- 별도 상태관리 패키지는 추가하지 않았다. 서버 상태는 React Query, 입력 상태는 React state/ref로 충분하다.
- 메뉴는 같은 출처의 일반 링크다. 현재 NodeNext 설정을 유지하고 경로마다 인증을 다시 확인하는 대신 SPA 전환보다 전체 페이지 이동 비용이 있다.
- 화면에 가짜 거래·예산·통계를 채우지 않았다. 비어 있는 계정에는 실제 빈 상태를 보여 준다.
- 인증 화면의 오프화이트·인디고·너비 규칙은 유지한다. 장부에는 승인된 Figma의 흰 헤더·청록색 메뉴·표 구성을 적용한다.
- 개발 모드 StrictMode는 effect의 정리를 재실행한다. 같은 인스턴스의 재검사와 실제 화면 이탈을 구분해 새 조회 캐시를 잘못 지우지 않는다.

## 6. 검증을 읽는 법

`*.test.ts(x)`는 계약·폼·버전·캐시 경계를 검사한다. `tests/e2e/core/core-web.spec.ts` 첫 사례는 실제 Chromium + Next BFF + Nest API + 로컬 PostgreSQL을 거친다. 인증 공급자만 합성 IdP이며 운영 Supabase OAuth 성공 증거는 아니다. 나머지 두 사례는 브라우저 HTTP 응답 일부를 대체해 오류·계정 불일치·접근성을 검사한다.

`core/run.ts`는 폐기용 DB를 만들고 Playwright가 실행한 서버를 종료한 다음 DB를 지운다. Playwright globalSetup의 정리만 사용하면 서버 pool이 아직 연결돼 DB 삭제가 실패했기 때문에 종료 순서를 분리했다. 강제 DB 삭제나 다른 개발 서버 종료는 하지 않는다.

현재 테스트 수·실행 명령·미검증 항목은 [검증 기록](../status/2026-09-30-core-web.ko.md)에 고정한다. PC 웹 변경은 앞으로도 실제 Playwright 검증을 완료 조건에 포함한다.
