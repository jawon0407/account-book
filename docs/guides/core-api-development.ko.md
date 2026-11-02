# 프로필·계좌·카테고리 API — 초급 개발자용 흐름 안내

기준: 2026-09-29. Node.js의 NestJS + Fastify 서버와 PostgreSQL을 연결했다. 이 문서의 **계좌는 가계부에 기록하는 계좌**이며 실제 은행 연결이나 송금 기능이 아니다. Supabase는 관리형 PostgreSQL과 인증 공급자로 사용한다. 브라우저에서 공개 키로 금융 테이블을 직접 읽지 않는다.

## 1. 어디까지 연결됐나요?

| 계층 | 지금 구현된 것 | 아직 남은 것 |
| --- | --- | --- |
| DB | 회원 3개·금융 5개 테이블, 사용자 격리·최소 권한 | 운영 백업·회수·공개 전 운영 검증 |
| Nest API | 프로필 조회/닉네임 수정, 계좌·분류 조회/생성/수정/보관 | 거래·이체 쓰기, 대규모 목록 페이지네이션 |
| 웹 BFF | 기존 인증 및 `/api/me` | 새 10개 동작을 중계하는 금융·프로필 route |
| PC 화면 | 기존 가입·로그인 등 인증 화면 | 로그인 후 장부, 프로필·계좌·분류 편집 화면 |
| 모바일 | 같은 서버 원장 공유 설계 | 별도 네이티브 앱 구현 |

새 API 성공은 아직 브라우저에서 계좌를 생성할 수 있다는 뜻이 아니다. 다음 단계에서 BFF와 `ky`·React Query 호출, 화면을 연결한다.

## 2. 요청이 처리되는 순서

```text
브라우저 → BFF의 세션/CSRF 검사 → 요청 한 번용 JWT 서명
                         ↓ 새 금융 BFF는 후속
Nest AuthGuard → strict 입력 검증 → 기능 repository
                         ↓
UserDatabase: BEGIN → SET LOCAL 사용자 → 활성 회원 검사
                         ↓
소유자 조건 + DB RLS → SQL 실행 → 응답 계약 검사 → COMMIT
                         ↓
Cache-Control: private, no-store 응답
```

`AuthGuard`는 JWT 서명뿐 아니라 어떤 경로·메서드·본문을 요청했는지도 검사한다. JWT의 `sub`에서 확인한 사용자 ID만 사용하며, 요청 JSON의 `userId`는 받아들이지 않는다. `scope`는 이 요청에서 할 수 있는 일이다. 예를 들어 `account:read`로 계좌를 만들 수 없다.

`repository`는 데이터를 읽고 저장하는 기능별 코드다. `UserDatabase.run(userId, operation)`은 모든 저장소가 지켜야 할 DB 작업 경계를 한곳에 모은 함수다.

- `userId`: 서명 검증이 끝난 본인의 UUID.
- `operation`: 같은 DB 연결을 인수로 받는 비동기 함수. 그 연결로 조회·수정을 한다.
- 성공하면 `COMMIT`까지 완료한 뒤 결과를 돌려준다.
- 실패하면 `ROLLBACK`으로 취소한다. 취소까지 실패하면 그 연결을 폐기한다.
- 요청 동안만 `SET LOCAL`로 사용자 문맥을 지정하므로 풀에서 다음 사용자에게 연결을 빌려줘도 문맥이 남지 않는다.
- SQL 5초, 잠금 대기 1초, 열린 transaction의 유휴 시간 5초 제한을 둔다. API 프로세스의 기존 최대 5개 풀을 재사용한다.

RLS는 PostgreSQL이 행 단위로 읽기·쓰기를 제한하는 기능이다. SQL의 `WHERE user_id = ...`와 RLS를 함께 사용한다. 관리자 DB 계정을 앱 런타임에 쓰지 않는다.

## 3. 경로와 매개변수

아래는 **Nest 서버 간 경로**다. 브라우저에 서버 간 토큰이나 DB 비밀번호를 넣어 직접 호출하지 않는다.

| 메서드·경로 | 입력 | 권한·성공 응답 |
| --- | --- | --- |
| `GET /v1/profile` | 없음 | `profile:read`, 200 Profile |
| `PATCH /v1/profile` | nickname, expectedVersion | `profile:write`, 200 Profile |
| `GET /v1/accounts` | 선택 query includeArchived | `account:read`, 200 `{items}` |
| `POST /v1/accounts` | kind, name, idempotencyKey | `account:write`, 201 Account |
| `PATCH /v1/accounts/:id` | name, expectedVersion | `account:write`, 200 Account |
| `POST /v1/accounts/:id/archive` | expectedVersion | `account:write`, 200 Account |
| `GET /v1/categories` | 선택 query includeArchived | `category:read`, 200 `{items}` |
| `POST /v1/categories` | kind, name, sortOrder, idempotencyKey | `category:write`, 201 Category |
| `PATCH /v1/categories/:id` | name 또는 sortOrder, expectedVersion | `category:write`, 200 Category |
| `POST /v1/categories/:id/archive` | expectedVersion | `category:write`, 200 Category |

`includeArchived`는 생략하면 false다. 정확한 문자열 `true` 또는 `false`만 받는다. `1`, `TRUE`, 같은 키를 두 번 보낸 query, 알 수 없는 query는 거부한다. 모든 입력은 Zod의 strict 계약으로 검증하며 알 수 없는 JSON 필드도 거부한다.

프로필 응답에는 id·nickname·avatarObjectKey·signupProvider·role·version·createdAt·updatedAt이 있다. 비밀번호·이메일·토큰·감사 로그는 없다. 수정 입력은 nickname과 expectedVersion뿐이다. nickname은 공백을 정리한 1~50자 또는 NULL이다. NULL은 닉네임 해제다. role, signupProvider, deletedAt, avatarObjectKey를 일반 수정으로 바꿀 수 없다. 이미지 업로드·관리자 승격·탈퇴 처리는 별도 기능이다.

계좌 종류나 분류 종류를 수정하는 경로도 아직 없다. 이름·정렬 순서·보관만 변경한다. 보관은 실제 행을 삭제하지 않아 과거 거래의 연결을 보존한다. 복원·물리 삭제 기능은 포함하지 않았다.

## 4. 같은 요청을 두 번 보내면 어떻게 되나요?

거래·계좌의 ID는 **저장된 항목의 번호**다. `idempotencyKey`는 **한 번의 생성 요청의 번호**다. 생성 요청을 다시 시도할 때 새 키를 만들면 별도 요청이 되므로, 응답이 끊긴 재시도는 같은 키와 같은 내용을 보내야 한다.

예: 사용자가 계좌 만들기를 누르고, 서버는 저장했지만 인터넷이 끊겼다.

1. 서버는 사용자 + 작업 종류 + 소문자로 정규화한 UUIDv4 키를 기준으로 transaction 잠금을 잡는다.
2. 이름의 공백 등을 정리한 의미 입력을 SHA-256으로 비교한다.
3. 처음이면 계좌와 최초 성공 응답을 같은 transaction에 저장한다.
4. 이미 성공한 같은 내용이면 그때의 응답을 돌려준다. 나중에 계좌 이름이 바뀌어도 최초 snapshot이다.
5. 같은 키로 다른 내용을 보내면 409 충돌이다. 다른 사용자나 계좌/분류처럼 다른 작업의 같은 키는 서로 간섭하지 않는다.

**재시도 때 BFF는 새 JWT를 발급하되 idempotencyKey는 유지한다.** JWT를 그대로 재사용하면 보안상 401이다. 생성 성공 및 동일 요청 재응답은 모두 201이다. 서버가 자동으로 금융 생성 요청을 재시도하지는 않는다.

## 5. PC와 모바일에서 동시에 수정하면?

`expectedVersion`은 사용자가 마지막으로 읽은 버전이다. 버전 1을 본 PC와 모바일이 동시에 이름을 바꾸면 먼저 처리한 요청만 성공하여 버전 2가 된다. 나중 요청은 409로 거부한다. 화면은 최신 내용을 다시 조회하고 사용자의 의도를 확인해야 한다. 버전을 무시하고 오래된 화면의 값으로 덮어쓰지 않는다.

다른 사용자의 계좌 ID를 보내면 존재하지 않는 ID와 똑같이 404를 반환한다. 보관된 항목의 수정은 409다. 탈퇴했거나 활성 프로필이 없는 사용자는 401이다. 이 검사는 전체 세션 회수나 이미 진행 중인 탈퇴 요청 취소까지 구현한 것은 아니다.

## 6. 잔액은 어떻게 계산하나요?

계좌 잔액은 삭제 표시가 없는 `transactions`의 합계다.

- 수입·이체 입금·자산 시작 잔액: 더한다.
- 지출·이체 출금·부채 시작 잔액: 뺀다.
- 내 계좌 간 이동은 한쪽에서 빠지고 다른 쪽에 들어간다. 새로운 수입으로 해석하지 않는다.

DB의 큰 정수 합계는 먼저 문자열로 받는다. JavaScript `BigInt`로 정확한 범위를 확인하고 안전한 정수일 때만 JSON 숫자로 바꾼다. 범위를 넘으면 0이나 반올림한 잔액을 보여주지 않고 고정 503 오류로 중단한다. 실제 은행 잔액 조회 API는 아직 연결하지 않았다.

## 7. 오류를 화면에서 다루는 기준

| 상태 | 의미 | 후속 화면 처리 |
| --- | --- | --- |
| 400 | 입력/지원하지 않는 필드·query | 입력을 바로잡는다 |
| 401 | 인증 실패·탈퇴·프로필 부재 | 세션 확인 후 재로그인 안내 |
| 404 | 내 자원이 아님 또는 없음 | 목록을 다시 확인한다 |
| 409 | 오래된 버전·멱등성 충돌·보관 상태 | 최신 조회 후 상태에 맞게 안내 |
| 503 | DB 오류·잠금 제한·응답 무결성 문제 | 실패를 표시하고 제한적으로 재시도 |

DB 오류 원문·SQL·키·접속 주소는 응답하지 않는다. request ID와 고정 오류 코드로 추적한다. 목록은 현재 최대 1,000행이다. 초과하면 잘린 목록을 정상처럼 반환하지 않고 503으로 거부한다. 이는 **후속 페이지네이션이 필요한 현재 제한**이며 실운영 규모 확장 완료를 뜻하지 않는다. 장부용 abuse/rate limit과 운영 경보도 공개 전 별도로 보완해야 한다.

## 8. 파일을 읽는 순서와 검증

1. `packages/contracts/src/profiles.ts`, `accounts.ts`, `categories.ts`: 입력과 응답의 모양.
2. `apps/api/src/*/*.controller.ts`: 경로·scope·입력 검사.
3. `apps/api/src/core/user-database.ts`: 사용자·transaction·오류 경계.
4. 각 `*.repository.ts`: 실제 SQL과 공개 응답 매핑.
5. `apps/api/src/core/idempotency.ts`: 생성 요청 잠금·최초 응답 저장.
6. `tests/database/core-api.test.ts`: 실제 최소 권한 PostgreSQL로 소유권·경쟁·복구를 검증.
7. `apps/api/src/core/core-http.test.ts`: 실제 Nest·서명 JWT로 HTTP 경계를 검증. 여기서 repository는 대역이며 실제 저장 검증은 6번에 있다.

실행 명령은 `pnpm test`, `pnpm test:db`, `pnpm lint`, `pnpm typecheck`, `pnpm build`다. **DB 테스트는 허용된 폐기용 로컬 DB에서만** 수행하고 hosted Supabase URI를 넣지 않는다. 정상 계좌 생성뿐 아니라 잘못된 권한·동시 생성·다른 사용자·잠금 timeout·rollback·overflow를 확인해야 한다.

이번 실행 증거와 미완료 항목은 [진행 기록](../status/2026-09-29-core-api.ko.md), 테이블별 설명은 [기본 스키마](../database/core-schema.ko.md)를 확인한다.
