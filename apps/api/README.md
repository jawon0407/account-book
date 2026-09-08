# API 애플리케이션

이 폴더는 NestJS로 요청 처리 구조를 만들고 Fastify로 HTTP 요청을 받는 서버다. 현재는 공개 상태 확인 `GET /health`와, BFF가 발급한 위임 JWT로 보호되는 현재 사용자 조회 `GET /v1/me`가 구현되어 있다.

아직 계좌·카테고리·거래·이체 API나 금융 데이터 저장은 구현되어 있지 않다. 해당 입력/응답 모양은 `packages/contracts`에 정의되어 있다. 금융 자원의 사용자별 소유권 확인, 버전 충돌 검사, 같은 생성 요청의 중복 실행 방지, 잔액 변경은 앞으로 금융 API에서 구현해야 할 책임이다. 현재 JWT의 재사용 차단을 금융 요청의 중복 처리 방지와 혼동하면 안 된다.

## 코드를 읽는 순서

1. `src/main.ts`: 서버를 만들고 파서·보안 헤더·종료 훅을 등록한 뒤 포트를 연다.
2. `src/environment.ts`: 환경 변수를 검사한다. API에는 공개키만 두고 개인키나 BFF 세션 DB 자격 증명은 두지 않는다.
3. `src/auth/auth.guard.ts`: 원시 헤더의 중복, Bearer 형식, 요청 ID, 본문 길이, 경로 권한을 검사한다.
4. `src/auth/jwt-verifier.ts`: 서명·클레임·실제 요청 해시를 검증하고 토큰 사용 사실을 기록한다.
5. `src/persistence/postgres-replay-store.ts`: PostgreSQL 기본키와 단일 INSERT로 같은 토큰의 재사용을 막는다.
6. `src/me/me.controller.ts`: 검증된 사용자 ID를 반환한다. 현재 email은 null, emailVerified는 true로 고정하며 별도 프로필 조회는 하지 않는다.
7. `src/common`: 응답 추적 ID를 일관되게 붙이고 내부 오류를 안전한 고정 응답으로 바꾼다.

`GET /health`의 성공은 HTTP 처리가 살아 있다는 뜻이지 DB 연결이나 전체 인증 경로가 정상이라는 증거는 아니다.

## 인증 경계

- 브라우저는 같은 출처의 BFF를 통해 요청한다. API는 브라우저용 CORS를 등록하지 않는다.
- 위임 JWT는 BFF가 특정 요청 하나에 대해 발급하는 짧은 수명의 서명 토큰이다. API는 설정에 있는 P-256 공개키와 허용된 키 식별자(`kid`)만 신뢰하며 원격으로 키를 가져오지 않는다.
- 발급자·수신자, ES256 알고리즘, 30초 수명, 경로 권한, 요청 결합 해시, 토큰 ID(`jti`)를 검사한다. 요청 결합은 메서드·URL·콘텐츠 유형·실제 본문·요청 ID가 서명 시점과 일치하는지 확인하는 방식이다.
- 성공 직전에 토큰 ID의 SHA-256만 PostgreSQL에 원자적으로 기록한다. 원문 JWT는 저장하지 않으며 이미 기록된 토큰은 다시 사용할 수 없다. 만료 행 정리는 별도 운영 작업이다.
- `BFF_AUTH_DISABLED=true`이면 키 조회나 재사용 기록 전에 검증을 중단한다. 문제가 생겼을 때 인증을 모두 거부하는 API 전용 중지 스위치다.
- `Authorization`은 정확한 `Bearer <JWT>` 하나만 허용한다. 중복 헤더, 잘못된 형식, 지원하지 않는 `crit`, 허용되지 않은 키는 상세 자격 증명 없이 거부한다.
- 응답에는 토큰·키·쿠키·DB 연결 정보나 예외 원문을 넣지 않는다. 인증 실패는 401, 검증 불가와 일반 오류는 503, 엄격히 식별한 본문 크기 초과 오류는 본문 없는 413으로 처리한다.

## API 환경 변수

| 변수 | 형식과 경계 |
| --- | --- |
| `API_HOST` | 기본 `127.0.0.1`; `0.0.0.0`도 파서가 허용하므로 외부 노출 제한은 배포 구성이 책임진다 |
| `API_PORT` | 기본 `3001`; 앞자리 0 없는 정수 문자열 `1..65535` |
| `API_DATABASE_URL` | API 전용 `app_api` 계정의 서버 전용 PostgreSQL 연결 문자열 |
| `BFF_AUTH_DISABLED` | 정확한 `true` 또는 `false`; API 독립 인증 중지 스위치 |
| `BFF_JWT_ACCEPTED_KIDS` | 허용할 키 ID 1~3개를 담은 중복 없는 JSON 배열 |
| `BFF_JWT_PUBLIC_KEYS` | `kid`별 P-256 SPKI DER 공개키를 base64url로 담은 JSON 객체 |

운영 시 `app_api` DB 자격 증명은 BFF 세션용 계정 및 마이그레이션용 계정과 분리해야 한다. API에는 BFF 개인키·세션 DB 계정·쿠키/CSRF 비밀값을 전달하지 않고, BFF에는 API의 DB URL·공개키 목록·허용 키 목록·중지 스위치를 전달하지 않는다. 개인 서명키는 BFF에만 배포하고, 키 교체 때는 새 키와 이전 키의 겹치는 기간 및 이전 키 제거 후 거부 동작을 검증해야 한다.

## 검증 명령과 남은 운영 증거

아래는 실행 가능한 명령이며, 이 문서 자체가 실행 성공을 의미하지는 않는다.

```powershell
$env:CI='true'
pnpm --filter @account-book/api test
pnpm --filter @account-book/api typecheck
pnpm --filter @account-book/api build
```

인증 E2E에서는 해당 실행용 ES256 공개키와 테스트 DB의 API 전용 계정을 사용한다. BFF의 `/api/me` 성공은 서명·발급자/수신자·권한·요청 결합·만료·토큰 ID·재사용 차단 검증을 통과해야 한다. 브라우저가 API 자격 증명을 직접 제출하는 구조가 아니며, 401/503 응답은 정상 동작 확인의 성공 증거가 아니다.

출시 전에는 로컬 Node 22.15.1 고정, 실제 테스트 PostgreSQL 권한과 재사용 차단, 이전 키 제거, 인증 중지 스위치, 동일 커밋의 CI 성공을 별도 증거로 확인해야 한다.
