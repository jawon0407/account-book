# 거래 시각 API·PC 연결 — 구현·검증 기록

기준: 2026-10-16, linked worktree `ledger-public-contracts`, `feature/bank-state-transitions`, HEAD `8af7a0d` 이후 미커밋 작업. 운영 Supabase 적용·배포·Android 설치 완료를 뜻하지 않는다.

## 이번에 달라진 점

모바일 수기 화면에서 보낼 **날짜와 시각을 서버가 검증·저장하고 PC에서 보존하며 편집할 수 있는 경로**를 연결했다. 모바일 입력 화면 자체는 다음 단위다.

예를 들어 사용자가 거주 기준을 `Asia/Seoul`로 지정하고 10월 16일 15:53에 20,000원을 지출했다고 입력하면, API는 `2026-10-16T06:53:00.000Z`라는 UTC 순간과 장부 날짜 `2026-10-16`, 분 단위 정밀도, 사용자 입력 근거, 적용한 거주 시간대를 함께 저장한다. 위 값은 합성 예시다. 시각을 모르면 날짜만 기록하며 자정으로 꾸며 넣지 않는다.

## 처리 흐름과 함수 설명

1. `UpdateProfileInputSchema`는 닉네임 또는 거주 시간대와 `expectedVersion`을 받는다. 사용자가 효력 시각·소유자·권한을 보내는 것은 허용하지 않는다.
2. `ProfilesRepository.update(userId, input)`는 본인 프로필 행을 잠그고 버전을 비교한다. 새 시간대 이력과 프로필 변경은 함께 성공하거나 함께 취소된다. 효력 시각·순번은 DB가 정한다. 같은 시간대 재선택은 이력을 늘리지 않는다.
3. `TransactionsRepository.create(userId, input)`는 동일 요청 키와 내용이 이미 성공했는지 먼저 확인한다. 성공한 재시도에는 당시 결과를 돌려주므로 이후 거주지 변경이 과거 응답을 바꾸지 않는다.
4. `resolveManualTime(client, userId, date, time)`는 본인 프로필을 잠그고 발생 시점에 해당하는 이력과 다음 변경, 최대 두 행을 읽는다. 평생 변경 이력을 256개로 잘라내지 않는다. 거주 변경을 걸친 불확실한 시각이나 날짜 불일치는 확인 오류로 반환한다.
5. `changedTime(client, userId, row, value)`는 부분 수정의 의미를 정한다. `time`을 생략하면 유지, `time:null`과 날짜를 명시하면 시각 미확인으로 정정한다. 시각이 있는데 날짜만 조용히 바꾸는 요청은 차단한다.
6. 목록은 날짜 → 시각 → 고유 ID의 내림차순이다. 시각 미상은 같은 날짜의 마지막이다. `encodeCursor`/`decodeCursor`는 다음 페이지 경계와 소유자·필터 결속을 검증한다. 커서 자체는 권한 증명이 아니며 RLS가 별도로 적용된다.
7. PC의 `transactionTimeLabel(row)`는 저장한 시간대로 표시한다. 브라우저가 해외에 있더라도 기기 시간대로 바꾸지 않는다. 수신 시각 근거라면 추정임을 표시한다.

## PC 사용 방식

- 목록에는 날짜와 알고 있는 정밀도까지의 시각·시간대가 표시된다. 과거 날짜-only 거래는 `시간 미확인`이다.
- 시각 있는 거래의 메모·상대명·계좌·분류를 수정해도 시각은 유지된다.
- 날짜-only로 정정하려면 **기록된 시각을 지우고 날짜만 지정**을 선택한다. 선택을 취소하면 원래 날짜도 되돌린다.
- PC 신규 거래 생성 금지는 그대로다. 완전한 시각 재입력·DST 입력 화면은 후속 Android 작업과 함께 구현한다.

## 파일 지도와 작업 규모

단순 CSS가 아니라 계약·DB·API·PC가 연결된 중간 규모 기능이다. 최초 예상20~25파일보다 공용 오류 목록·실제 DB fixture·브라우저 검증·성능 보완이 늘었다. 기존 혼합 미커밋 변경 전체를 이번 작업량으로 계산하지 않는다.

| 영역 | 주요 파일 | 역할 |
| --- | --- | --- |
| 공용 계약 | `packages/contracts/src/transaction-time.ts`, `ledger-time.ts`, `profiles.ts`, `transactions.ts`, `errors.ts`, `index.ts` | 입력·응답·오류와 시각 정밀도 검증 |
| 프로필 API | `apps/api/src/profiles/profiles.repository.ts`, controller | 시간대 이력과 프로필 버전의 원자적 변경 |
| 거래 API | `transaction-time.ts`, repository, mapping, changes, cursor | 당시 기준 선택·저장·편집·정렬·페이지 |
| DB | `20261016082800_ledger_time_cursor_index.sql`, `ledger-transactions.ts` | 부분 인덱스·시간대 검사 성능·SQL/ORM 일치 |
| PC | time-label, table, edit-form, use-transaction-change, feedback, ledger CSS | 표시·명시적 해제·복구 가능한 오류 안내 |
| 시험 | 공용 시각, API HTTP/cursor, DB profile/time/history, PC table/edit, Playwright | 위조·소유권·동시성·멱등·실제 사용자 흐름 |

## 발견한 문제와 수정 이유

- 공용 오류 필드 목록에 `time`이 빠진 계약 회귀를 보완했다.
- 테스트 mock의 미사용 매개변수2건과 엄격한 optional 타입 불일치를 수정했다. 검사 규칙은 끄지 않았다.
- 기존 시간대 검증은 매번 전체 시간대 목록을 읽어 로컬에서 약214ms/회로 측정됐고 300개 이력 fixture가 시간 초과했다. 이름 하나를 검사하는 경로로 보완했다. 숫자를 포함하면 PostgreSQL의 POSIX 표현으로 해석될 수 있어 정확한 목록 대조를 유지한다. `Asia/Seoul+09` 허용 오류는 RED로 재현 후 차단했다. 이 측정은 운영 지연이나 한국망 성능 목표를 증명하지 않는다.
- 빨라진 DB에서 시계 역행 테스트의 준비용 변경 두 개가 같은 밀리초에 겹쳤다. 최초 합성 이력을 명시적 과거로 준비해 결정적으로 만들었으며 제품의 시계 역행 차단은 유지했다.
- 새 정렬은 v2 커서를 쓴다. 기존 v1은 새 목록 조회를 요구한다. 구형 커서를 섞어 누락/중복 페이지를 만드는 것보다 명시적 재조회가 안전하다.
- 실제 화면 캡처에서 체크박스 정렬을 보정했다. Impeccable의 기존 화면 유지·오류/설명 연결 지침을 적용했으며 전면 디자인 변경은 하지 않았다.

## 현재 확인한 실행 결과

- `pnpm verify`: 종료0. 린트·7 workspace 타입·일반 시험 **2,068개**(legacy208/공용176/DB단위19/API320/web1211/mobile48/preflight86), API/웹 build, Android JS/Hermes 번들1,370모듈·3.3MB. 실제 DB 시험과 APK는 이 숫자에 포함하지 않는다.
- 전체 로컬 DB: **413개/37파일/78.55초/종료0**. 처음 실행의 clock fixture1실패는 위 수정 후 재검증했다.
- PC Playwright: **19개/57.4초/종료0**. 합성 인증+실제 로컬 Next/Nest/폐기용 DB로 새 시각 거래 생성→PC 수정→명시적 해제→재조회, 기존 계정 격리·접근성·권한 회귀를 확인했다. 1440px/390px 캡처와 가로 넘침 검사를 포함한다. 작은 CSS 보정 뒤 재실행 결과는 아래에 추가한다.
- Git 대상850파일의 등록된 비밀 패턴 탐지0건. 모바일 env·서명키·Expo 캐시 무시 확인. 모든 비밀값 부재를 보증하는 검사는 아니다.
- 실제 Supabase·유료 플랫폼·사용자 금융 데이터는 변경하지 않았다. 기존 node-forge/braces 의존성 경고2건은 이번에 재감사하거나 해결하지 않았으며 출시 게이트로 남긴다.

검증 로그: `output/ledger-time-api-verify-final.log`, `output/ledger-time-api-db-final.log`, `output/ledger-time-api-pc-e2e.log`. 화면: `tests/e2e/output/playwright/transaction-time-*.png`.

## 독립 리뷰·최종 후속

독립 읽기 전용 코드·보안 리뷰1회: **Critical0 / Important0 / Minor1**. 현재 시각 API와 직접 연결 경계에서 차단 결함은 발견되지 않았다. 전체 혼합 브랜치나 운영 보안 감사 완료는 아니다.

보류 Minor: 기존 구버전 멱등 fixture가 `counterpartyName`만 제거해 최신 `time` 필드는 남긴다. 실제 repository 경로에서 time도 없는 JSON의 재시도 회귀를 더 직접적으로 보강해야 한다. optional 공용 계약 시험은 있고 제품 결함은 확인되지 않았으므로 이번 차단 수정에는 포함하지 않았다.

CSS 보정 후 PC **19개/54.1초/종료0** 재확인 및 1440/390px 캡처 확인을 마쳤다. 체크박스 크기·정렬을 기존 UI에 맞췄다. 로그 `output/ledger-time-api-pc-final.log`.

리뷰에서 보증하지 않은 부분은 그대로 남긴다: 혼합 Android/auth/collector 전체, APK/실기기·알림·고급 DST UI, 운영 인덱스 잠금/부하, 서로 다른 tzdb의 모든 역사적 차이, 원격 PR/CI/배포. 이력 결과/JS 계산량이 두 행이라는 설명은 DB 검색 비용까지 상수라는 뜻이 아니다. 운영 이관은 이관 주체·백업·승인 SHA·잠금 영향을 확인한 뒤 migration을 먼저 적용하고 호환 API를 배포해야 한다. 런타임 앱 시작 시 이관하지 않는다.

## 원격 상태·다음 단계

읽기로 확인한 [PR #22](https://github.com/jawon0407/account-book/pull/22)는 OPEN이며 원격 head는 `264a7f6`이다. 기존 security-gate 두 실행은 실패 상태이고 최신 로컬 구현은 원격에 없다. 이번 단위에서 커밋/푸시·CI 재실행·병합·배포는 하지 않았다.

다음은 Android 거주 기준 설정·수기 입력·계좌/카테고리 선택 UI를 기존 인증·원장 API에 연결하는 작업이다. 알림 listener/판독/중복·선택형 규칙·다중 필터·환불/복구·정밀 합계와 APK/실기기는 여전히 남아 있다. Android 승인 범위 구현·검증 후 iOS 순서를 유지한다.

설계: [시각 API](../superpowers/specs/2026-10-16-ledger-time-api-design.md), 실행 기록: [계획/판단 원장](../superpowers/plans/2026-10-16-ledger-time-api.md).
