# 보안 검증 체크리스트

## 1. 사용 방법

체크 표시는 증거가 있을 때만 한다. “프레임워크가 알아서 처리한다”, “ID를 추측하기 어렵다”, “UI에서 숨겼다”는 증거가 아니다. PR 작성자는 증거를 제공하고 검토자는 실패 경로를 확인한다.

## 2. 설계 시작 전

- [ ] 처리하는 자산과 데이터 등급을 식별했다.
- [ ] 새 공개 엔드포인트, OAuth scope, 파일, 외부 호출, 관리자 기능을 식별했다.
- [ ] 신뢰 경계와 STRIDE 위협을 갱신했다.
- [ ] 사용자 간 객체 권한과 관리자 권한 규칙을 문장으로 정의했다.
- [ ] 실패·재시도·롤백·중복·순서 역전 동작을 정의했다.
- [ ] 수집, 보존, 내보내기, 삭제 범위를 정의했다.
- [ ] 보안 요구사항을 테스트 가능한 수용 조건으로 변환했다.

## 3. 구현과 코드 리뷰

### 인증·세션

- [ ] 검증된 서버 인증 문맥에서만 사용자 ID를 얻는다.
- [ ] JWT의 서명, 허용 알고리즘, issuer, audience, 만료를 검증한다.
- [ ] OAuth에 PKCE, `state`, OIDC `nonce`, 정확한 redirect URI를 사용한다.
- [ ] 계정 연결·해제와 민감 작업에 최근 재인증을 요구한다.
- [ ] refresh token과 비밀정보를 브라우저 영구 저장소에 넣지 않는다.
- [ ] 로그아웃·비밀번호 변경·위험 감지 시 세션을 폐기한다.
- [ ] 로그인과 재설정 응답이 계정 존재 여부를 노출하지 않는다.

### 권한·데이터

- [ ] 모든 금융 쿼리에 사용자 소유권 조건이 있다.
- [ ] 연관 리소스가 같은 사용자 소유인지 검증한다.
- [ ] RLS와 애플리케이션 권한 검사가 서로 다른 방어선으로 동작한다.
- [ ] 일반 앱 DB 역할에 superuser 또는 `BYPASSRLS`가 없다.
- [ ] service-role key가 일반 요청 경로에 노출되거나 사용되지 않는다.
- [ ] 금액·이체·동기화·삭제가 원자적 트랜잭션을 사용한다.
- [ ] 두 사용자와 두 기기를 사용하는 음성 권한 테스트가 있다.

### 입력·출력·API

- [ ] DTO는 허용 필드만 받고 알 수 없는 필드를 거부하거나 제거한다.
- [ ] 문자열·배열·본문·페이지·파일 크기와 금액·날짜 범위를 제한한다.
- [ ] SQL 값은 매개변수화하고 동적 식별자는 허용 목록을 사용한다.
- [ ] 사용자 입력을 HTML, 명령, 경로, URL로 직접 연결하지 않는다.
- [ ] 상태 변경에 안전한 HTTP 메서드와 CSRF 방어를 사용한다.
- [ ] CORS는 정확한 origin만 허용한다.
- [ ] 오류 응답에 스택, SQL, 내부 경로, 공급자 원문이 없다.
- [ ] 보안 헤더와 CSP가 테스트된다.

### Delegated BFF 변경 경계

- [ ] BFF delegated request interface가 browser `userId`, `Authorization`, cookie, host, browser request ID를 받지 않는다.
- [ ] `method`, relative `target`, canonical `contentType`, exact body bytes의 SHA-256, server-generated `requestId`를 하나의 request binding에 넣고, route metadata의 최소 `scope`를 API에서 다시 검증한다.
- [ ] mutation은 `POST`·`PATCH`·`DELETE`의 non-empty JSON만 허용하고 raw body와 `content-length`의 exact byte count를 검사한다. JSON parser와 guard의 상한은 같은 32 KiB(32,768 bytes)다.
- [ ] BFF signer와 upstream fetch가 동일 `Uint8Array` body를 사용하며, one-byte body·target/query·scope·duplicate raw header 변경과 replay를 fail closed 테스트로 확인했다.
- [ ] BFF→API timeout은 3초이며 signer·timeout·network·replay-store 오류가 요청 허용으로 바뀌지 않는다.
- [ ] `BFF_JWT_PRIVATE_KEY`는 Vercel server-only secret만 사용하고 Heroku API에는 없다. Heroku에는 public-key set과 accepted `kid`만 secret으로 주입한다.
- [ ] public-key rotation은 current + previous key만 제한적으로 overlap하고, 새 key signing·이전 `kid` 제거/거부 drill을 같은 변경에서 검증한다.
- [ ] 구조화 로그는 `requestId`, `jti`, principal/route/result를 남기되 JWT, 원문 body, cookie, key material 또는 body 재구성값을 남기지 않는다.
- [ ] API owner가 인증 principal + route를 rate-limit key로 구현하고, 신뢰 가능한 platform IP는 보조 signal로만 사용한다. 기한은 **최초 hosted delegated mutation release 전**이며, rate-limit backend·route/scope·trusted platform IP 의미 변경 전 재검토한다.

### 오프라인·파일·동기화

- [ ] IndexedDB에 토큰과 불필요한 개인정보가 없다.
- [ ] 로그아웃·계정 전환·탈퇴 시 로컬 데이터가 제거된다.
- [ ] 서버가 오프라인 데이터의 인증·소유권·버전을 다시 검증한다.
- [ ] idempotency key 재전송이 중복 거래를 만들지 않는다.
- [ ] 오래된 version과 충돌을 조용히 덮어쓰지 않는다.
- [ ] CSV 수식, 잘못된 인코딩, 초과 행, 큰 파일을 안전하게 처리한다.
- [ ] 업로드 원본과 서명 URL에 명시적 만료·삭제 정책이 있다.

### 비밀정보·로그·개인정보

- [ ] 새 비밀정보가 비밀 저장소에서 최소 권한으로 주입된다.
- [ ] 비밀정보 회전과 폐기 방법이 문서화됐다.
- [ ] 로그·URL·분석 이벤트·오류에 민감 데이터가 없다.
- [ ] 인증·권한·내보내기·삭제 이벤트에 감사 로그가 있다.
- [ ] 수집·보존·삭제가 기능 목적에 필요한 최소 범위다.

## 4. PR 필수 자동 게이트

권장 CI 순서는 다음과 같다.

```text
format
→ lint
→ typecheck
→ unit
→ integration
→ authn/authz security tests
→ secret scan
→ SAST
→ SCA/license review
→ build
→ E2E security smoke
→ SBOM
```

최소 도구 기준은 다음과 같다. 같은 목적을 더 잘 충족하는 도구로 교체할 수 있지만 게이트 자체를 생략할 수 없다.

- 비밀정보: Gitleaks 또는 동등한 Git 기록·작업 트리 검사
- SAST: CodeQL이나 Semgrep 규칙과 TypeScript 린트 보안 규칙
- SCA: 패키지 관리자 production audit와 OSV-Scanner 또는 동등한 취약점 DB
- 공급망: lockfile 고정 설치, GitHub dependency review, 설치 스크립트 검토
- 이미지·파일 시스템: Trivy 또는 동등한 스캐너를 배포 형태가 생긴 시점부터 적용
- SBOM: CycloneDX 형식으로 릴리스 아티팩트에 연결
- DAST: 스테이징 환경이 생긴 뒤 OWASP ZAP baseline과 인증된 핵심 흐름 검사

다음 결과는 즉시 실패로 처리한다.

- 실제 형식의 secret 또는 개인 키 탐지
- 치명적·높음 등급의 직접 악용 가능한 취약점
- 인증·권한·사용자 격리·CSRF·세션 회귀 테스트 실패
- lockfile 불일치 또는 승인되지 않은 의존성 설치 스크립트
- SBOM이나 필수 스캔 결과 부재

## 5. 배포 전 릴리스 게이트

- [ ] 모든 PR 필수 게이트가 같은 커밋에서 통과했다.
- [ ] 치명적·높음 미해결 위험이 0건이다.
- [ ] 중간 위험은 악용 경로, 보완 통제, 소유자, 30일 이내 재검토일이 있다.
- [ ] 스테이징에서 로그인, 로그아웃, 만료, 재인증, 공급자 연결·해제를 검증했다.
- [ ] 사용자 A/B 데이터 격리와 관리자 권한 부재를 검증했다.
- [ ] CORS, CSP, HSTS, CSRF, cookie 속성, 오류 마스킹을 실제 응답에서 확인했다.
- [ ] 속도 제한이 로그인·재설정·내보내기·가져오기·동기화 남용을 막는다.
- [ ] 백업 생성과 복구 절차를 검증했다.
- [ ] DB 마이그레이션의 권한·RLS·롤백 영향을 검토했다.
- [ ] 운영 secret이 개발·스테이징과 분리되고 회전 가능하다.
- [ ] 감사 로그와 경보가 테스트 이벤트를 탐지했다.
- [ ] DAST 결과와 수동 비즈니스 로직 테스트를 검토했다.
- [ ] `SECURITY.md`, 위협 모델, API·DB·운영 문서가 실제 구현과 일치한다.
- [ ] 롤백 기준, 담당자, 사용자 공지 경로가 준비됐다.

## 6. OWASP Top 10:2025 회귀 지도

| 범주 | 이 프로젝트의 대표 검증 |
|---|---|
| A01 Broken Access Control | 사용자 A/B 객체 권한, RLS, service-role 격리 |
| A02 Security Misconfiguration | CORS·CSP·cookie·오류·운영 권한 설정 테스트 |
| A03 Software Supply Chain Failures | lockfile, SCA, Action SHA, SBOM, 설치 스크립트 검토 |
| A04 Cryptographic Failures | TLS, 비밀 저장소, 토큰 검증, 백업 암호화 |
| A05 Injection | 매개변수 SQL, 출력 인코딩, CSV 수식 중화, 허용 목록 |
| A06 Insecure Design | STRIDE, 오용 사례, 속도 제한, 기본 거부 |
| A07 Authentication Failures | PKCE·state·nonce, 세션 회전·폐기, 재인증 |
| A08 Software or Data Integrity Failures | 멱등성, version 충돌, 아티팩트·마이그레이션 무결성 |
| A09 Security Logging and Alerting Failures | 인증·권한·내보내기·삭제 감사와 경보 |
| A10 Mishandling of Exceptional Conditions | 원자적 롤백, 안전한 오류, 제한 재시도, fail closed |

## 7. 정기 점검

### 매월

- [ ] production 의존성과 컨테이너 취약점을 다시 검사했다.
- [ ] 미사용 OAuth 앱, API key, DB role, GitHub 권한을 제거했다.
- [ ] 비밀정보 회전 예정과 실패한 회전 기록을 확인했다.
- [ ] 인증 실패, 권한 거부, 대량 내보내기 경보를 검토했다.
- [ ] 만료된 위험 수용이 없는지 확인했다.

### 분기별

- [ ] 위협 모델과 데이터 분류를 실제 아키텍처와 대조했다.
- [ ] 백업에서 격리 환경으로 복구하고 RLS·정합성을 검증했다.
- [ ] 계정 탈취, secret 유출, 교차 사용자 접근 사고 연습을 수행했다.
- [ ] 관리자 MFA, 최소 권한, 보호 브랜치, CODEOWNERS를 검토했다.
- [ ] ASVS 기준과 도구 버전 변경을 검토했다.

## 8. 위험 수용 규칙

위험을 수용하는 기록에는 반드시 다음 내용이 있어야 한다.

- 구체적인 공격자와 악용 단계
- 노출되는 데이터와 사용자 영향
- 심각도와 판단 근거
- 지금 수정하지 않는 이유
- 적용한 보완 통제와 한계
- 책임자와 승인일
- 30일 이내 재검토일 또는 더 빠른 수정 릴리스

치명적·높음 위험은 일정 사유로 수용할 수 없다. 중간 위험도 반복 수용하지 않으며 기한이 지나면 릴리스를 차단한다.

## 9. 무료 플랜 저장소 게이트

- [ ] `pnpm setup:hooks`가 성공했고 `git config --local --get core.hooksPath`가 정확히 `.githooks`를 출력한다.
- [ ] `pnpm test:security-gate`, `pnpm test`, `pnpm verify:structure`의 결과와 검사한 commit SHA를 PR에 기록했다.
- [ ] workflow trigger는 `pull_request`와 `push`뿐이고 권한은 최상위 `contents: read`뿐이다.
- [ ] workflow가 `pull_request_target` 또는 `secrets.*`를 사용하지 않는다.
- [ ] 모든 `uses:`가 검토한 전체 commit SHA에 고정되어 있다.
- [ ] checkout이 `fetch-depth: 0`, `persist-credentials: false`를 사용한다.
- [ ] push concurrency group이 실행마다 고유한 `github.run_id`를 사용하고 push의 `cancel-in-progress`는 false이며, PR 실행만 PR 번호로 그룹화하고 취소 가능하다. 같은 SHA ref push도 pending 실행을 대체하지 않아야 한다.
- [ ] workflow 구조 정책과 canonical 전체 파일 digest 테스트가 모두 통과한다.
- [ ] 로컬 HEAD, PR `headRefOid`, 성공한 `security-gate` Check의 SHA가 같다.
- [ ] branch protection/rulesets HTTP 403과 secret scanning/push protection HTTP 422의 잔여 위험을 수동 확인했다.
- [ ] 로컬 hook의 `--no-verify` 우회 가능성과 CI의 사후 탐지 한계를 PR에 기록했다.
- [ ] 코드, diff, 로그, 문서, fixture에 실제 비밀정보 또는 실제 사용자 재무 데이터가 없다.
- [ ] 5 MiB 초과 blob이 있으면 수동 승인으로 우회하지 않고 파일 제거·검토된 별도 저장·또는 보안 검토된 검사 코드/한도 변경이 완료될 때까지 push와 merge를 중단했다.

운영 절차와 위험 수용 종료 조건은 [GitHub 무료 플랜 보완 통제](free-plan-compensating-controls.md)를 따른다.

## 10. Task 13 인증 출시 gate

- [ ] 성공 응답에 provider token이 없고 hardened opaque cookie 하나만 생성된다.
- [ ] Browser storage와 browser Authorization header에 token state가 없다.
- [ ] `/api/me` 200이 real BFF와 static public-key/accepted-`kid` delegated ES256 API를 통과한다. request binding과 atomic `jti` replay consume을 확인하며 401/503은 성공이 아니다.
- [ ] API `BFF_AUTH_DISABLED` kill switch, keyring overlap, accepted `kid` 제거 rotation drill이 같은 SHA에서 통과한다.
- [ ] Logout 뒤 `/api/me`가 401이고 DB session이 revoked다.
- [ ] 390x844/1440x900 label, keyboard, axe, overflow가 통과한다.
- [ ] Production fake adapter가 readiness 전에 process startup을 fail closed한다.
- [ ] Non-production public host의 fake adapter가 첫 request graph 생성 전에 fail closed한다.
- [ ] Pinned PostgreSQL, frozen install, verify, DB, E2E, audit, final scan 순서와 digest가 일치한다.
- [ ] Hosted DB login은 owner가 아니고 `app_session_bff` role만 갖는다.
- [ ] Google/Kakao/`custom:naver` live checklist를 완료했다. 미실행이면 운영 출시를 차단한다.
- [ ] Evidence commit SHA와 CI head SHA가 같다.
- [ ] delegated mutation matrix가 exact body 200, one-byte mismatch, query mismatch, read scope, replay, expiry, duplicate raw headers, 32 KiB 초과 413과 verifier 미호출을 확인했다. Platform owner는 hosted Vercel/Heroku secret·key rotation 증거를, Security owner는 BFF 침해 대응 훈련을 **최초 hosted delegated mutation release 전** 완료한다. secret/keyset 배치 또는 BFF delegation scope 변경 전 재검토한다.
- [ ] Fastify `5.10.0` / Nest `11.1.28` body-too-large 413 allowlist는 API owner가 두 dependency 업그레이드 또는 parser/filter 변경 전에 oversized·forged-413 fail-closed integration regression으로 재검토했다. 이 재검토가 없으면 해당 변경을 배포하지 않는다.
