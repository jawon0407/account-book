# 보안 기준과 문서 지도

## 1. 목적

이 디렉터리는 Account Book의 보안 요구사항, 검증 방법, 사고 대응 절차를 한곳에서 관리한다. 보안은 구현 후 점검 항목이 아니라 요구사항, 설계, 코딩, 리뷰, 배포, 운영 전 과정의 승인 조건이다.

2026-09-08: 아래 목록은 보안 **요구사항**이며 전부 구현·운영 검증됐다는 뜻은 아니다. [문서 지도](../README.md)에서 실제 인증 코드·금융 계약·미구현 모바일/운영 범위를 구분한다. 제품은 PC 웹 + 별도 네이티브 앱이며 초기 PWA·오프라인 큐 설계는 적용하지 않는다.

문서 간 우선순위는 다음과 같다.

1. 루트 `SECURITY.md`의 중단 조건과 보고 정책
2. `security-architecture.md`의 자산·신뢰 경계·필수 통제
3. `free-plan-compensating-controls.md`의 무료 플랜 제한, 로컬·CI 보완 통제, 잔여 위험과 종료 조건
4. `verification-checklist.md`의 PR·릴리스 증거
5. `incident-response.md`의 사고 처리 절차
6. 기능별 ADR과 API·DB 문서

충돌이 있으면 더 엄격한 통제를 적용하고 같은 PR에서 문서를 정정한다.

## 2. 적용 기준

- OWASP ASVS v5.0.0 Level 2 요구사항을 기본 검증 범위로 사용한다.
- 인증, 권한, 세션, 암호, 재무 데이터는 위험에 따라 ASVS Level 3 요구사항을 선별 적용한다.
- OWASP Top 10:2025를 위협 범주와 회귀 테스트 분류에 사용한다.
- OWASP Cheat Sheet Series를 구현 세부 기준으로 사용한다.
- NIST SSDF SP 800-218을 개발 수명주기와 공급망 운영 기준으로 사용한다.
- SentinelOne의 웹 애플리케이션 위협 목록은 공격 시나리오 누락을 찾는 보조 자료로 사용한다.

## 3. 변경할 수 없는 기본 원칙

1. 모든 금융 데이터 접근은 인증과 객체 소유권 검사를 통과해야 한다.
2. `userId`와 권한은 검증된 서버 인증 문맥에서만 얻고 요청 본문·쿼리에서 받지 않는다.
3. 브라우저 저장소에 비밀번호, OAuth client secret, service-role key, refresh token을 저장하지 않는다.
4. 일반 금융 쿼리는 PostgreSQL의 `BYPASSRLS` 권한이 없는 애플리케이션 역할로 수행한다.
5. SQL은 매개변수화하고 동적 식별자는 서버 허용 목록으로 제한한다.
6. 모든 운영 통신은 HTTPS를 사용하며 평문 HTTP는 HTTPS로 리디렉션한다.
7. 서비스 키와 공급자 비밀정보는 비밀 저장소에서 주입하고 코드·Git·로그에 남기지 않는다.
8. 로그와 분석 이벤트에는 토큰, 비밀번호, 전체 계좌 식별자, 거래 메모 원문, CSV 원문을 기록하지 않는다.
9. 초기 금융 영구 캐시·오프라인 쓰기 큐를 만들지 않는다. 로그아웃·계정 전환 시 이전 사용자의 메모리 상태를 정리하고 모바일 credential 저장은 별도 secure storage 경계로 구현한다.
10. 외부 파일과 콜백은 크기, 형식, 서명, 출처, 재전송 여부를 검증한다.
11. 치명적·높음 보안 위험은 수정되기 전까지 병합과 배포를 막는다.
12. 보안 예외는 문서화된 위험 수용과 만료일 없이는 허용하지 않는다.

## 4. 책임과 증거

팀이 구성되기 전 보안 책임자는 저장소 소유자다. 보안 책임자는 위협 모델 변경, 위험 수용, 운영 비밀정보 접근, 사고 종료를 승인한다. 구현자는 자신이 작성한 통제의 유일한 검토자가 될 수 없으며, 팀원이 한 명뿐인 동안에는 자동 검사 결과와 재현 가능한 수동 검증 기록을 함께 남긴다.

PR에는 다음 증거를 연결한다.

- 영향을 받는 자산과 신뢰 경계
- 추가되거나 변경된 공격 표면
- 실행한 인증·권한·입력·동기화 보안 테스트
- 비밀정보·정적 분석·의존성 분석 결과
- 남은 위험과 보완 통제
- 관련 문서 또는 ADR 변경

## 5. 기준 자료

SentinelOne 자료에서 설명한 위협과 이 프로젝트의 통제 연결은 다음과 같다.

| 참고한 위협·권고 | Account Book 통제 |
|---|---|
| credential stuffing과 봇 로그인 | 로그인·재설정 다중 신호 rate limit, 계정 열거 방지 응답, 인증 실패 경보, 운영자 MFA |
| API 공격과 중간자 공격 | HTTPS·HSTS, 엔드포인트별 인증, 객체 소유권 검사, 정확한 CORS, 토큰 issuer·audience 검증 |
| 제3자·공급망 공격 | lockfile, SCA, Action SHA 고정, 설치 스크립트 검토, SBOM, 에이전트 스킬 검토 |
| SQL injection과 원격 코드 실행 | 매개변수 SQL, 동적 식별자 허용 목록, 사용자 입력의 명령 실행 금지, SAST와 음성 테스트 |
| DDoS와 자동화된 남용 | edge·API rate limit, 요청 크기·페이지 제한, 작업별 quota, 관리형 인프라의 DDoS 완화 기능 |
| cookie poisoning과 session hijacking | opaque 세션 쿠키, DB selector 해시·provider credential 암호화, `Secure`·`HttpOnly`·`SameSite`, CSRF 방어, 회전·폐기 |
| 개발 초반부터 SAST·DAST·침투 테스트 | PR SAST·SCA, 스테이징 DAST, 고위험 확장 전 독립 침투 테스트 |
| 전송 중·저장 시 보호 | TLS, 관리형 저장 암호화, 암호화 백업, 비밀정보 저장소, 최소 권한 |

이 자료는 위협 누락을 찾는 설명 자료로 사용한다. 구체적인 검증 요구사항은 OWASP ASVS와 Cheat Sheet, 개발 수명주기는 NIST SSDF를 기준으로 한다.

- [SentinelOne: 웹 애플리케이션 보안이란 무엇인가?](https://www.sentinelone.com/ko/cybersecurity-101/cybersecurity/what-is-web-application-security/)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/)
- [OWASP ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0_release)
- [OWASP REST Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)

## 6. 검토 주기

- 기능 설계 시: 자산, 신뢰 경계, 오용 사례를 검토한다.
- 모든 PR: 보안 영향과 자동 검사 결과를 확인한다.
- 모든 릴리스: `verification-checklist.md`의 릴리스 게이트를 통과한다.
- 매월: 의존성, 비밀정보, 권한, 운영 계정, 로그 경보를 점검한다.
- 분기별: 전체 위협 모델과 복구 연습을 검토한다.
- 중대한 기능 추가 또는 사고 후: 주기와 무관하게 즉시 갱신한다.
