# 프로필·계좌·카테고리 NestJS API 설계

사용자 요청: 이미 생성한 개발 DB의 프로필·계좌·카테고리를 NestJS에 연결한다. 기존의 반복 승인 생략 지시를 적용하되 작업 범위·변경 파일·검증 결과를 먼저 기록한다. 이번은 신규 데이터 접근 계층과 HTTP 경계가 추가되는 기능 개발이다. 기존 인증·DB 미커밋 변경을 보존하고 푸시/배포/실사용자 금융 기록 생성은 하지 않는다.

## 목적·선택

PC 웹과 향후 별도 모바일 앱이 동일한 서버/DB를 사용할 기반을 만든다. 인증은 기존 BFF 발급 요청 결합 JWT·AuthGuard·replay 저장소를 유지한다. public Supabase Data API에 테이블을 노출하지 않는다.

| 접근 | 장점 | 단점 | 결정 |
| --- | --- | --- | --- |
| 기존 Nest + pg 저장소, 고정 SQL + Zod 계약 | 현재 인증 풀/권한 재사용, SQL 잠금·RLS·원자성 명확 | 쿼리와 응답 매핑을 직접 검증해야 함 | 채택 |
| 별도 ORM/service 전면 재구성 | 모델 중심 추상화 | 풀 중복·역할 분산·기존 인증 회귀 범위 증가 | 지금 제외 |
| 브라우저 Supabase 직접 CRUD | 화면 연결이 짧음 | 승인한 BFF/API 보안 경계 변경 | 제외 |

## API 계약

- `GET /v1/profile`: 본인 활성 프로필, role, 가입 경로, version·시각. 이메일/토큰/감사 로그 미포함.
- `PATCH /v1/profile`: `{nickname: string|null, expectedVersion:number}`. nickname 1~50자 trim. role/signupProvider/deletedAt/avatarObjectKey 수정 거부. 이미지 업로드는 별도.
- `GET /v1/accounts`, `GET /v1/categories`: 기존 목록 응답. 쿼리 `includeArchived=true|false`만 허용, 기본 false. 미지원/중복/배열 값 거부.
- `POST /v1/accounts`, `POST /v1/categories`: 기존 strict 생성 계약·UUIDv4 idempotencyKey. 201과 최초 성공 응답. 같은 내용 재시도도 최초 응답 201.
- `PATCH /v1/accounts/:id`, `PATCH /v1/categories/:id`: 기존 수정 계약·expectedVersion. 보관 상태는 수정 금지.
- `POST /v1/accounts/:id/archive`, `POST /v1/categories/:id/archive`: expectedVersion 검사, soft archive. hard DELETE/복원 제외.
- 기존 `/v1/me`는 유지. scope는 profile:read/profile:write를 추가하고 계좌/분류는 기존 scope 사용.
- 새 BFF 프록시·화면 호출은 이번 Nest API 이후 작업. API를 브라우저 CORS로 공개하거나 사용자 JWT로 대체하지 않는다.

## 처리 흐름과 권한

검증된 principal → strict 입력 계약 → 동일 process pool → BEGIN → SET LOCAL 사용자 UUID/timeout → 활성 프로필 검사 → 소유자 WHERE + 강제 RLS → 응답 계약 검사 → COMMIT → 안전한 JSON. 사용자 ID를 body/query에서 받지 않는다. 풀·AuthGuard는 기존 MeModule에서 export하여 한 번만 생성한다.

DB transaction의 statement timeout 5초, lock timeout 1초, idle-in-transaction timeout 5초. 오류면 rollback 후 연결 반환, rollback 실패 시 연결 폐기. DB 원문·SQL·사용자 데이터 로그 금지. 탈퇴/프로필 부재는 401. 해당 사용자의 자원 부재는 404, 입력 400, 버전/멱등성/보관 상태 충돌 409, DB/응답 불일치는 고정 503. 이는 전체 탈퇴·진행 중 요청 취소를 구현하는 범위는 아니다.

계좌 잔액은 삭제되지 않은 원장의 합계다: income/transfer_in/opening asset는 +, expense/transfer_out/opening liability는 -. PostgreSQL numeric 합계를 문자열로 받아 bigint 범위 검사 후 안전한 JSON number로 변환한다. 표시용 0으로 overflow를 숨기지 않는다. 목록은 최대 1,000행을 지원하고 초과는 고정 오류로 거부하며 조용히 잘라 반환하지 않는다. 대규모 목록 cursor는 후속 계약 확장이다.

## 멱등성·동시 수정

생성 요청은 정규화한 의미 입력(kind/name/sortOrder)의 고정 순서 JSON을 SHA-256으로 fingerprint한다. 사용자+작업+소문자 UUID 키의 transaction advisory lock을 잡고 기존 결과를 검사한다. 같은 fingerprint는 저장된 최초 snapshot을 반환하고 다른 내용은 409. 행 생성과 snapshot 기록을 같은 transaction으로 묶는다. 유효 응답만 저장/반환하고 실패/rollback은 접수 기록을 남기지 않는다. 같은 키는 다른 사용자/작업과 격리한다. lock timeout은 503 재시도이며 자동 재시도는 하지 않는다.

수정은 WHERE user_id/id/version/활성 상태가 모두 맞아야 성공한다. DB trigger가 version을 증가시킨다. 두 요청 중 하나만 성공하고 다른 요청은 409이며 타 사용자 ID는 404로 통일한다.

## 파일과 검증

- 계약: `packages/contracts/src/profiles.ts`, 오류/scope/index 확장, 계약 테스트.
- 공통 서버: `apps/api/src/core/` transaction·오류·입력·숫자 매핑·멱등성·module.
- 기능별: `apps/api/src/profiles/`, `accounts/`, `categories/` controller/repository. 각 파일은 하나의 책임과 한국어 함수/인수 주석을 갖는다.
- HTTP 테스트는 실제 Nest/Fastify+서명 JWT를 사용하고 DB만 대역으로 주입한다. 실제 저장·소유권·경쟁 검증은 loopback 폐기용 PostgreSQL에서 실제 app_api 역할로 수행한다.
- 기존 전체 테스트·DB 테스트·lint·typecheck·build 및 최종 독립 리뷰. 원격 Supabase에 합성 금융 행을 넣거나 migration을 다시 실행하지 않는다.

## PC 디자인 참조 (별도 화면 단계)

참조: https://bass-spider-28476196.figma.site/transactions . 2026-09-29 별도 Playwright 브라우저 1440×1000에서 직접 확인했다. 앱 내 브라우저 helper는 ACL 오류, 일반 웹 읽기는 접근 실패하여 대체 도구를 사용했다.

흰색 전체 너비 헤더(약 76px), 연한 회색 본문, 중앙 가로 탭, 청록색 선택 탭/주요 버튼, 제목·설명 왼쪽 및 생성 버튼 오른쪽, 흰색 얇은 테두리 테이블 패널, 우측 종류 필터, 행 구분선·상태 배지·정렬된 숫자. 창고용 SKU/상품/수량은 계좌/분류/금액으로 한국어 도메인에 맞춘다. 참고 사이트의 창고 관리 기능·샘플 거래·Figma 배너를 가져오는 것은 아니다.

기존 로그인 뉴모피즘 CSS와 60vw 너비 규칙을 이번에 일괄 변경하지 않는다. 새 장부 화면의 넓은 표 레이아웃은 별도 토큰/구조로 적용한다. 대비·키보드·오류/로딩/빈 상태·reduced motion은 Impeccable 제품 기준을 유지한다. 스크린샷은 Git 제외 `output/playwright/transactions-reference.png`에 보존했다. 디자인 확인은 했지만 이번 Nest API 구현을 화면 구현 완료로 표시하지 않는다.

## 자체 검토

원격 데이터 변경 없음, 관리자 기능 없음, 사용자 입력 소유권 신뢰 없음, 동일 풀 및 기존 인증 유지. 저장 기반/API/브라우저 연결/디자인을 구분한다. 공개 계약에 없는 페이지네이션·이미지 업로드·거래 쓰기를 끼워 넣지 않는다.
