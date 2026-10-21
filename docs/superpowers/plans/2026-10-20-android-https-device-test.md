# Android HTTPS 실기기 → PC 검증 계획

요청: 테스트 HTTPS 연결, 기기 로그인, 수기 입출금 저장, PC 동일 기록 확인, Notion 보고.
기준: 기존 기능 worktree와 설치된 개발 APK를 재사용한다. 운영 DB·실제 계정·금융 알림은 제외한다.

## 선택과 범위

- USB reverse로 loopback 서버에 접근한다. 공개 터널/클라우드 배포는 만들지 않는다.
- 별도 단기 CA를 생성하고 Android **debug source set**의 localhost 전용 신뢰에만 넣는다. 인증서 검증 무시·휴대폰 시스템 CA 추가 없음.
- 기존 core E2E setup/합성 IdP/실제 Next BFF/Nest API/PostgreSQL을 재사용한다. 합성 로그인은 운영 Supabase 로그인 검증이 아니다.
- DB는 새 폐기용 로컬 cluster다. hosted DB·기존 DB는 변경하지 않는다. 실패 시 기존 DB를 덮어쓰거나 강제 삭제하지 않는다.
- PC는 Playwright 실제 브라우저로 확인한다. 모바일 저장을 서버 직접 INSERT로 대체하지 않는다.
- 기존 혼합 미커밋 변경 보존. 커밋/푸시 없음.

## 흐름

Android UI → HTTPS localhost:3000(USB) → Next native BFF → 서명된 요청 → Nest → 폐기용 PostgreSQL

PC UI → 같은 HTTPS BFF(웹 쿠키 채널) → 같은 Nest/DB → 모바일 거래 확인

## 작업과 완료 조건

- [x] 개발 전용 인증서 적용 도구와 경계 테스트. release 소스/전역 신뢰 불변.
- [x] 테스트 stack 기동·loopback 바인딩·TLS 정상 검증. 운영 secret 상속 차단.
- [x] 개발 APK 리소스 재생성/설치 및 실제 기기 테스트 로그인. 전체 네이티브 clean build는 긴 경로 문제로 미완료.
- [x] 실제 화면에서 미지정/미분류 수기 지출·수입 각 1건 저장, 목록 확인.
- [x] PC 로그인 후 동일 상대명/금액/방향/날짜 확인, 중복 0.
- [x] 로그아웃·두 번째 계정에서 자료 비노출 검증.
- [x] 검증/보안·한계/다음 단계 문서와 Notion 기록.

## 예상 파일

- `apps/mobile/tooling/apply-debug-trust.cjs`, 대응 테스트: 개발 산출물에만 신뢰 설정 적용.
- `tests/e2e/device/run.ts`: 기존 fixture를 실제 기기 검증 동안 실행하는 테스트 도구.
- 이 계획, 실기기 가이드, 상태 보고서. 필요 시 발견한 결함은 근거를 기록하고 범위 안에서 별도 수정/회귀 검증.
- 인증서/개인키/APK/DB/log/screenshot은 Git 제외 output에만 생성한다.

## 검토 초점

localhost CA가 release/다른 도메인/전역 신뢰로 확장되지 않는지, 비밀 상속/로그 노출, 타 계정 접근, 미지정 거래 저장, HTTP/브라우저/native 채널 혼합을 확인한다.
자동계획의 전체 제품 재설계/별도 CLI 다중 모델 파이프라인 통과를 주장하지 않는다. 승인된 연결 검증 범위의 계획·보안·실사용·코드 검토를 별도로 기록한다.

## 실행 기록

- 사전 확인: Android16 실기기 1대 승인/앱 전경, Metro 8081 loopback 실행. 3000/4510/4511/5432 미실행.
- Android 공식 network security configuration의 앱별·도메인별 신뢰와 debug source set 격리 사용.
- 실기기 지출20,000원/수입50,000원 → PC 각1건 확인. 날짜-only/미지정 유지, 두 번째 계정 비노출.
- 독립 도구 리뷰3건 보완. PC 초기 GET 제출 발견·POST/hydration 잠금 보완 및 Playwright 재검증.
- 최종 전체 `pnpm test` 2,144개 통과·종료0. web/e2e 타입·변경 코드 린트·diff 공백 통과.
- 실패/빌드 재사용/비밀·신뢰 경계와 전체 리뷰 미포함 항목은 `docs/status/2026-10-20-android-https-device-test.ko.md`에 기록했다.
