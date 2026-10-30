# Android 세션 자격 증명 교체 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Use checkbox syntax to track tasks.

**목표:** Android 갱신 시 식별자 해시와 제공자 암호문을 원자적으로 교체하고 웹 동작을 유지한다.
**설계:** [세션 교체 계약](../specs/2026-10-16-native-session-rotation-design.md).
**기술:** TypeScript, 기존 SessionService, Drizzle/PostgreSQL, Vitest, Playwright.

## 1. TDD 계약

- [x] 서비스 테스트: 새 자격 증명으로만 조회, 이전 값 재사용 거부, 절대 만료 유지, 동시 갱신 패자 실패, 저장 실패/폐기 경합 시 비밀 미반환.
- [x] 어댑터 테스트: Android 해시·기기·채널 조건, 한 UPDATE, 잘못된 입력 거부, 웹 식별자 불변.
- [x] 실제 DB 테스트: 이전 값 무효화, 다른 채널/기기/해시 거부, 독립 연결 경쟁의 단일 승자, 원자성·폐기/만료 검증.
- [x] 서비스/어댑터 변경 전 78개 중 7개 실패를 확인했다. DB 시작 진단 후 DB 시험은 구현 이후 실행했으며 DB RED를 실행했다고 주장하지 않는다.

## 2. 구현

- [x] 저장 계약에 선택적 Android 식별자 교체 조건을 추가한다.
- [x] 저장소 갱신이 웹/Android 경계를 지키고 원자적으로 실행되도록 한다.
- [x] Android만 새 식별자를 만들고 저장 승자에게 반환한다. 패자는 안전한 만료 오류로 처리한다.
- [x] 함수 역할과 매개변수 주석을 보완한다.

## 3. 검증·인계

- [x] 대상 78개, 전체 verify 1,766개, 실제 임시 DB 328개, PC Playwright 15개 통과. 독립 DB 연결 경쟁 보강 후 대상 DB 22개·린트·DB 타입 재통과.
- [x] 인증 분기 coverage 878/878, 의존성 경고 0, 독립 코드/보안 리뷰 Critical/Important/Minor 0. 후속 앱의 갱신/로그아웃 직렬화 주의점 기록.
- [x] MD와 Notion 04/07에 실제 결과와 남은 Android HTTP/앱 작업을 구분해 기록하고 재조회했다.
- [x] 운영 DB·배포·커밋/푸시는 이번 단위에서 실행하지 않았다.
