# 알림 기능 의존성 보안 보완 — 2026-11-02

## 원인과 수정

지난 커밋 `117e536`의 GitHub CI 두 실행은 `pnpm audit --prod --audit-level high`에서 실패했다. `expo-router → query-string → decode-uri-component` 경로에서 기존 0.5.0 강제 버전이 [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f)에 해당한다. 앞선 재귀 처리 문제를 고친 버전에도 서로 다른 잘못된 인코딩을 치환할 때 처리량이 급증하는 문제가 남아 있었다.

이번에는 범위를 한정한 override를 0.5.1로 올리고 생성된 잠금 파일을 갱신했다. query-string의 기존 default export 호환 패치는 유지했다. CI 기준이나 예외 목록은 바꾸지 않았다. 앱·서버 업무 로직 및 DB는 수정하지 않았다.

## 검증 근거

- 실제 설치된 Navigation parser에 서로 다른 percent run 32,000개와 잘못된 suffix를 전달하는 회귀시험 추가. 자식 프로세스의 5초 제한으로 테스트 자체의 장시간 정지를 방지한다.
- 수정 전: 새 시험에서 5초 시간 초과, 기존 시험 5건 통과.
- 수정 후: 전체 라우터·정책 시험 11건 통과. 새 입력은 이 PC에서 약 0.15초에 완료했다. 이 수치는 기기/환경별 성능 보장이 아니다.
- 잠금 파일 packages/snapshots에 취약 버전이 섞이는 변형도 거절하는 정책 시험 포함.
- 최신 production 감사: 수정 전 High1/Moderate2/Low1 → 수정 후 High0/Moderate2/Low1. High 기준 감사 종료0.
- 로컬 검증: lint, 전체 typecheck, 테스트 2,397건, API·웹 빌드와 Android export 통과(종료 0). DB 통합 시험과 실제 브라우저 E2E는 이 숫자에 포함하지 않으며 원격 CI에서 별도로 확인한다.
- 로컬에서는 Git이 무시하는 기존 `output/` 임시 화면 검사 파일의 브라우저 전역 변수 때문에 원래 lint 명령이 실패했다. 해당 파일과 제품 설정은 건드리지 않고 로컬 ESLint 명령에만 `--ignore-pattern output/`을 적용한 뒤 나머지는 원래 verify와 같은 단계를 실행했다. 원격 CI의 `pnpm verify`는 변경하지 않았다.
- 제한된 실행 환경에서 임시 Git 저장소/Bash 권한 시험이 실패해 동일 검사를 정상 권한으로 다시 실행했고 위 결과를 확인했다. 테스트를 삭제하거나 건너뛰지 않았다.
- 독립 코드 리뷰: Critical 0 / Important 0 / Minor 0. 리뷰어가 추가로 실행한 라우터 6건·취약 잠금 파일 변형 시험도 통과했다. 실제 Android 기기 성능까지 보장하는 검사는 아니다.
- 정확한 새 SHA의 원격 CI는 푸시 후 확인한다. 로컬 통과만으로 원격 통과 또는 전체 보안 승인을 주장하지 않는다.

## 남아 있는 경고와 범위

- Moderate: minimatch `GHSA-g3hv-75wg-m249`, glob `GHSA-3g3m-2fjr-6pw4`.
- Low: deepmerge `GHSA-gcqx-w48m-w2h4`.
- 위 경고는 별도 호환성·영향 검토 대상이다. High 기준 통과가 전체 취약점 0건 또는 앱 전체 보안 승인이라는 뜻은 아니다.
- 실제 금융 알림/비밀값/기기 로그/APK는 이 패치에 포함하지 않는다. 운영 DB 변경과 배포는 수행하지 않는다.

## 다음 단계

원격 CI 통과를 확인한 후 기존 승인 설계에 맞춰 알림 최소 추출값의 API·DB 접수를 시작한다. 저장 시점의 세션·동의·대표 기기 검증, 계좌/분류 미지정 원장, 동일 요청 1회 반영을 우선한다. 앱 자동 전송·백그라운드 수집·여러 은행 형식 확대는 별도 단계다.
