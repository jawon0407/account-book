# Android 의존성 보완 — 2026-10-16

대상은 `ledger-public-contracts`의 Android 첫 기반 후속 변경이다. **iOS는 Android 승인 범위 구현·실기기 검증 후 진행한다.** 이번에는 DB/PC 제품 기능·인증 정책을 바꾸지 않았다. 앞선 첫 기반 기록의 수치는 당시 결과로 보존한다.

## 무엇을 왜 바꿨나

보안 감사 경고 3건 중 URI 디코더 1건을 공식 수정판으로 교체했다. `expo-router@57.0.28 → query-string@7.1.3 → decode-uri-component@0.2.2`가 설치된 경로였다. query-string 전체를 9.x로 올리면 export 형식이 달라지므로 범위를 좁혔다.

- `pnpm-workspace.yaml`: query-string 7.1.3의 decoder만 0.5.0으로 고정.
- `patches/query-string@7.1.3.patch`: decoder의 ESM default 함수를 받도록 한 줄 수정. decoder 알고리즘을 직접 복제하거나 고치지 않는다.
- `pnpm-lock.yaml`: 실제 버전·패치 해시를 재현 가능하게 저장.
- `scripts/workspace-policy.test.mjs`: 한정된 override를 정책 목록에 반영.
- `apps/mobile/tooling/router-query.test.cjs`: 설치된 코드를 직접 호출하는 5개 회귀.
- 모바일 README·계획·결과 문서: 작동 원리와 검증/미검증 경계를 설명.

기존 혼합 변경을 포함한 전체 Git diff의 수천 줄을 이번 변경량으로 계산하지 않는다. 제품 로직 변경은 패키지 import 호환 한 줄이며, 자체 URL/암호 알고리즘은 만들지 않았다.

## 재현과 리뷰에서 배운 점

포함된 React Navigation 코어에 잘못된 percent 입력 1,500개를 주면 수정 전 별도 프로세스의 5초 제한을 넘겼다. 수정 후 같은 시험은 약 56ms에 종료했다. 이는 해당 Node 시험의 측정이며 앱 응답 속도/FCP 또는 휴대폰 측정이 아니다.

독립 리뷰가 테스트 경로를 지적했다. **Expo가 실제 연결한 fork의 입력 파서는 URLSearchParams를 사용하므로, 위 재현을 실제 앱 deep link의 악용 증거로 표현하면 안 된다.** 기존 3개를 포함된 코어 회귀로 명확히 표시하고 실제 Expo fork의 한국어/복수 값 왕복과 잘못된 바이트 처리 2개를 추가했다. 테스트에서는 RN UI 모듈 묶음만 원래의 순수 config validator로 대체하고, 쿼리 처리·decoder는 실제 설치 구현을 사용한다. 네이티브 런타임 시험을 대신하지 않는다.

첫 테스트 작성 때 코어가 배열을 그대로 왕복할 것이라는 잘못된 기대도 발견했다. 코어의 기존 문자열 동작에 맞춰 범위를 수정했고 실제 fork에서는 배열 왕복을 별도로 검증했다. 이 과정에서 제품 라우팅을 임의 변경하지 않았다.

## 남은 경고와 도달성

재감사: **high 2, moderate 0, 종료 1**. 0건으로 표시하거나 audit 예외를 넣지 않았다. 확인한 registry 최신은 node-forge 1.4.0, braces 3.0.3이며 두 공식 공지에는 수정판이 없다.

| 패키지 | 확인한 사용 경로 | 판단/다음 조치 |
| --- | --- | --- |
| node-forge | Expo CLI의 로컬 인증서 읽기·서명 도구. `codesigning.js`의 로컬 PEM 읽기→validateSelfSignedCertificate, 서명 직후 verify 호출 확인 | 거래 API나 앱의 원격 TLS 검증기로 쓰는 경로는 확인하지 못함. 미해결 개발 도구 위험으로 유지. 외부 인증서를 무작정 수용하지 않으며 공식 패치/상위 교체 후 재감사 |
| braces | Metro file-map→micromatch의 watcher glob 처리. 패턴은 source extension 등 도구 설정에서 생성되고 파일명은 검사 대상 인수 | 앱의 거래/알림 원문이 glob 패턴으로 전달되는 경로는 확인하지 못함. 외부 입력으로 개발 설정을 만들지 않고 개발 서버 공개 노출을 피함. 수정판 추적 및 재검증 |

설치 경고의 high 등급과 현재 앱에서 확인한 공격 가능성을 구분한다. 공격 경로를 못 찾았다는 것은 무해함/무취약점 보증이 아니다. 공식 공지: [URI 디코더](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## 검증

- 공식 패치 설치 후 `pnpm verify`: 종료 0. 린트·7 workspace 타입·2,007개 테스트·API/웹 build·Android JavaScript/Hermes export(1,368모듈/3.3MB). 이 실행은 리뷰 후 추가한 fork 시험 2개 직전이다.
- 추가한 fork 2개 포함 경로 회귀 5개: Node 22.15.1에서 통과. 이후 최종 `pnpm test` **2,009개**(legacy208 + contracts124 + DB단위19 + API318 + web1206 + mobile48 + preflight86), 종료 0. 마지막 lint도 종료 0. 모바일48개는 순수/어댑터39 + 도구9다.
- PC core Playwright 18개, 39.3초, 종료 0. 로컬 BFF/NestJS·폐기용 DB·합성 인증 사용. 색상 환경변수 경고가 있었으나 시험 실패는 없었다.
- 감사는 위 2건으로 종료 1. 프로젝트 배포/실금융 베타 게이트는 열지 않는다.
- 독립 범위 리뷰: 테스트 경로 정확성 P2 1건 발견·반영. 패치/override/lock의 다른 차단 지적은 없음. 전체 혼합 PR 리뷰 완료가 아니다.
- `autoplan`의 필수 참조와 `qa-only` 보고 템플릿이 설치본 지정 경로에 없어 완전한 두 파이프라인은 미수행. 명시 계획·설치된 리뷰 체크리스트·독립 리뷰·TDD·기존 Playwright 회귀로 대체했다. 브라우저 회귀를 Android 실기기 QA로 표시하지 않는다.

## 다음 구현과 사용자 준비

Android 이메일 로그인/조회 기반은 유지하며 다음은 **개발 APK 검증과 모바일 수기 거래 입력·계좌/카테고리 선택**이다. 정확한 거래 시각/시간대 계약은 그 입력 기능 전에 현재 날짜형 계약과 함께 정리한다. 그 뒤 지속 로그인 보강·수집 설정 화면·동의/허용 출처·한 형식의 알림 접수로 이어간다. 알림 수집과 자동 기록은 여전히 미구현이다.

이 PC의 표준 Android Studio/SDK·Java 경로와 PATH에서 SDK/JDK/adb를 찾지 못했다. 실제 APK/실기기 검증에는 개발 도구, 개발용 기기 또는 에뮬레이터, 기기에서 신뢰할 수 있는 HTTPS 테스트 BFF가 필요하다. 다른 위치의 설치 유무는 단정하지 않는다. 아직 APK 설치·동의 화면·백그라운드 수집·스토어 제출을 완료 처리하지 않는다.

이번 단위는 커밋/푸시·원격 CI·병합·실제 DB·배포를 하지 않았다. 기존 미커밋 작업을 보존했다.

Notion 최상위·04 기술 구조·07 진행 상태를 갱신했으며 비동기 저장 성공과 다시 읽기로 최신 수치/후속 기록을 확인했다. 과거 개발일지 수치는 당시 기록으로 남겼다.

이 보안 검토는 AI 보조 검사이며 전문 보안 감사나 침투테스트를 대체하지 않는다.
