# Android 인증 HTTP 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans. 구현과 테스트는 아래 체크로 추적한다.

**목표:** Android 앱이 호출할 이메일 로그인·조회·갱신·로그아웃 경로를 실제로 연결한다.
**설계:** [HTTP 계약](../specs/2026-10-16-native-auth-http-design.md).
**규모:** 공용 계약/서버 모듈·라우트 4개·DB 제한 종류·단위/DB/HTTP/PC 테스트·문서 약 20~26파일. 실제 변경량은 결과에 기록한다.

1. [x] 공용 요청/응답과 HTTP/제한 테스트 작성. controller·limiter·adapter 미구현 실패 확인(계약 전용 RED 실행은 별도 기록 없음).
2. [x] native-auth 폴더에 boundary·controller·limiter·route adapter를 역할별로 구현. 기존 검증 함수 재사용.
3. [x] native_auth 제한 종류의 추가형 migration·Drizzle·실제 DB 검증.
4. [x] 고정 Android SessionService와 컨테이너/Node.js 라우트 4개 연결.
5. [x] 실제 로컬 HTTP + PC Playwright, 전체 단위/타입/빌드/의존성·비밀 패턴/coverage 검증. 운영 침투시험은 아님.
6. [x] 독립 코드·보안 리뷰의 중요 지적 1건을 RED→GREEN으로 수정. MD/Notion 상태 갱신. 전체 Android/소셜/운영 완료로 표시하지 않음.

결과: 제품·시험·설정 31파일 + 문서 4파일. 역할별 분리와 SDK 로그아웃 회귀·HTTP 합성 인증 연결로 초기 예상보다 늘었다. 전체 verify 1,823개, 실제 DB 335개, PC/HTTP 17개 통과. 자세한 파일 설명·실패 기록·검증 한계는 [결과 보고](../../status/2026-10-16-native-auth-http.ko.md)에 있다.

운영 DB 적용·커밋/푸시·병합·배포는 이번 단위에서 수행하지 않는다. 기존 미커밋 은행/원장 작업을 보존한다. autoplan 참조 누락은 직접 설계 점검·TDD·독립 리뷰로 보완하며 전체 자동 파이프라인 완료를 주장하지 않는다.
