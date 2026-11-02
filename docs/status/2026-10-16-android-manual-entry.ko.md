# Android 수기 거래 입력 — 진행 기록

작업 시작2026-10-16, 최종 확인2026-10-17(한국시간). feature/bank-state-transitions linked worktree, HEAD8af7a0d 이후 미커밋 작업. **API·입력/저장 모델과 Android 수기 입력 화면 소스 연결까지 진행했다.** APK 설치·실기기 사용성·실제 금융 알림 수집 완료를 뜻하지 않는다.

## 이번에 구현한 부분

1. 프로필 조회/거주 기준 변경, 활성 계좌/카테고리 조회, 수기 거래 생성 API를 모바일에 연결했다.
2. 로그인한 본인 요청만 전송하고, 로그아웃/계정 전환/foreground 재검증 이전의 늦은 결과를 화면에 돌려주지 않는다. 다른 사용자 ID의 프로필 응답도 거부한다.
3. 계좌·카테고리·거래 상대명·메모는 선택으로 두고, 원화 양의 안전 정수와 날짜를 검증한다. 보관된 계좌/다른 방향의 카테고리를 선택하면 정정을 요구한다.
4. 날짜만 알면 시각을 만들지 않는다. 시각을 입력하면 명시 시간대로 UTC를 계산한다. 여름시간 전환으로 존재하지 않는 시각은 거부하고 두 번 존재하는 시각은 사용자가 선택한다.
5. 저장 시도당 UUID를 고정하고 중복 탭을 합친다. 네트워크·응답 판독·5xx 등 저장 결과 불명 시 같은 키와 내용으로만 명시적 재시도한다. 금융 정보를 디스크 대기열에 넣거나 자동 재전송하지 않는다.

## 초급 개발자를 위한 파일 설명

| 파일 | 역할/입력/결과 |
| --- | --- |
| `apps/mobile/src/api/native-ledger-client.ts` | 토큰·공용 계약 입력을 받아 고정 native API만 호출. URL·소유자·role을 사용자가 지정할 수 없음 |
| `apps/mobile/src/auth/session-manager.ts` | UI에는 토큰 없는 profile/accounts/categories/createTransaction을 제공. 내부 authenticatedRequest가 갱신·401·계정 세대를 공통 검사 |
| `apps/mobile/src/ledger/manual-input.ts` | 화면 문자열과 현재 계좌/분류·거주 기준을 받아 서버용 숫자/날짜/선택 참조로 변환. DB 쓰기는 하지 않음 |
| `apps/mobile/src/ledger/manual-time.ts` | 날짜·HH:mm·시간대·DST 선택값을 받아 정확한 UTC 분 시각 또는 두 후보를 반환 |
| `apps/mobile/src/ledger/manual-input-error.ts` | 입력 내용 대신 필드명과 고정 오류 코드만 화면에 전달 |
| `apps/mobile/src/ledger/manual-entry.ts` | 한 계정의 한 저장 시도를 관리. submit→saving→saved 또는 failed/uncertain. retry는 같은 payload/키만 사용 |

`uncertain`은 실패 확정이 아니라 **서버에 저장됐을 수도 있음**을 뜻한다. `beginNew()`는 이 상태에서 false를 반환한다. 화면에서 같은 요청 재시도 또는 목록 확인 후 중복 위험 동의를 거쳐 새 입력을 선택한다. `beginListCheck()`는 GET 시작 당시 이미 결과 불명인지 기록하고 `markListChecked(receipt)`는 그 표식이 같은 시도에 속할 때만 인정한다. `dispose()`는 메모리를 비우지만 이미 전송한 서버 쓰기를 취소하는 함수가 아니다.

## 검증과 발견한 문제

- API/세션 새13개: 구현 전 실패 확인. foreground 재검증 뒤 이전 응답 허용을 추가로 재현하고 epoch 검사로 보완했다.
- 입력/시간/저장 새35개: 모듈 부재 RED 후 구현. 모바일 전체 **96개**(vitest87+도구9) 통과. 계좌 없는 입력, 정확한 최대 금액, DST gap/overlap, 분 정밀도를 임의 보정하지 않는 사례, 동일 키 재시도·중복 탭·계정 폐기를 포함한다.
- Task1 모바일 typecheck 종료0. Task2 전체 verify 세션21997도 종료0을 확인했다. 이후 화면/리뷰 보완의 최종 결과는 별도로 기록한다.
- 비밀 패턴863파일/0건, diff 공백 검사 종료0. 등록 패턴 이외의 비밀값 부재를 보증하지 않는다.
- 의존성 감사는 **high2·종료1**. 기존 node-forge/braces이며 새 Temporal 관련 지적은 없다. 감사가 제시한 수정 범위(1.4.1/3.0.4)의 실제 패키지는 조회 당시 레지스트리에 없어 업데이트하지 않았다. 임의 포크·감사 예외는 추가하지 않았다.

새 시간 변환 의존성은 `@js-temporal/polyfill@0.5.1`과 `jsbi@4.3.2`다. 설치 스크립트 없이 설치하고 잠금 파일에 고정했다. [Temporal 공식 시각 변환](https://tc39.es/proposal-temporal/docs/zoneddatetime.html), [구현체 릴리스](https://github.com/js-temporal/temporal-polyfill/releases). 이후 UI에서 실제 참조해 Android Hermes 번들에 포함했다. export는 기기 런타임의 Intl/tzdb 실행 검증과 다르다.

## 화면 연결 및 독립 리뷰 보완

- `manual-workspace.ts`: 화면과 별도로 초안/시도 수명을 유지한다. 검증 중에는 편집을 막고, 같은 계정 복귀에는 유지하며 다른 계정에는 전달하지 않는다.
- `ledger-flow.tsx`: 목록·수기·거주 설정 경로와 Android Back을 연결한다. `manual-entry-screen.tsx`는 저장/결과 불명/오류/성공 흐름을 조립한다.
- `manual-entry-fields.tsx`·`form-controls.tsx`: 48dp 이상 동작, 긴 목록 가상화 선택 모달, 필드 이름/상태 접근성, 키보드 스크롤을 제공한다. `residence-screen.tsx`는 명시 저장만 하며 기기 시간대로 거주 기준을 바꾸지 않는다.
- 독립 읽기 전용 리뷰: Critical0/Important2/Minor1. Important2는 오래된 목록 응답으로 새 키를 만들 수 있는 경합과 이사 뒤 과거 거래의 날짜 불일치다. Minor의 늦은 설정 완료가 다른 계정 화면을 이동하는 문제는 계정 경계 영향으로 Important로 재분류해 함께 보완했다. 단일 보완 pass이며 독립 재리뷰 통과라는 뜻은 아니다.
- 경합은 GET 시작 표식 대조, 과거 거래는 선택형 당시 거주 시간대 입력(UTC 유지/서버 이력 대조), 설정 완료는 마지막 await 뒤 소유자/epoch와 화면 이동 세대 검사로 보완했다. 원시 오류·서버 문구를 UI/로그에 출력하지 않는다.
- 실패 근거: `android-manual-review-red.log`, `android-manual-stale-list-red.log`. 모바일 110개(101 Vitest+9도구) 통과 후 공유 fixture 대조 29개도 통과. 최종 전체 검증 결과는 아래에 별도 확정한다.
- DB와 모바일의 모듈 형식 차이로 첫 교차 import는 엄격 타입 검사에서 실패했다. 타입 검사를 느슨하게 하지 않고 공통 합성 wire fixture(`tests/fixtures/mobile-historical-transaction.json`)를 모바일 출력 전체와 대조하고 실제 DB 저장에 재사용했다. 네이티브 화면부터 DB까지 실행한 시험으로 설명하지 않는다.

## 아직 남은 검증/기능

- 입력 키보드·Android Back·TalkBack·글자 확대·실제 기기 시간대와 DST 확인.
- 네이티브 캡처 기반 디자인 finish review(자료 없음으로 보류), 운영 Supabase 이관과 배포. 커밋/푸시 없음.
- 알림 수집·분류·필터·환불·통계·iOS 등 전체 목표는 후속으로 그대로 남는다.

SDK/JDK/adb가 PATH와 표준 경로에서 발견되지 않았다. 기기 실행은 미완료이며 소스 개발 자체의 장애물은 아니다. PC 제품 코드는 이번에 바꾸지 않았다.

Impeccable은 기존 Bookify 화면의 좁은 확장으로 적용했다. 새 테마/이미지나 DESIGN.md 변경은 없고 HTML/CSS용 detector는 네이티브 코드에 실행하지 않았다. 캡처가 없어 시각 검증을 통과로 기록하지 않는다. 거주 이력·현재 기준 입력을 나눈 판단은 드문 이사 전 거래에 추가 입력이 생기는 비용이 있지만, 정확한 시각을 삭제하거나 서버의 날짜 보호를 완화하지 않는 선택이다.

계획: [Android 수기 입력](../superpowers/plans/2026-10-16-android-manual-entry.md). 설계: [데이터·상태 경계](../superpowers/specs/2026-10-16-android-manual-entry-design.md).

## 최종 검증 기록

- DB 전체 **414개/37파일/47.91초/종료0** (`output/android-manual-db-verified.log`). 합성 자료와 고정 loopback 폐기용 DB만 사용했다. 운영 Supabase에는 적용하지 않았다.
- 등록 비밀 패턴 **873파일/0건**, env.local/Android 서명키/Expo 캐시 gitignore 확인, diff 공백 검사 종료0.
- 의존성 감사 **high2/moderate0/critical0·종료1** (`output/android-manual-final-audit.json`). 배포/실금융 베타 게이트를 유지한다.
- 최종 `pnpm verify` **2,130개**(legacy208/공용176/DB단위19/API320/web1211/mobile110/preflight86), 린트·7 workspace 타입·API/웹 build·Android JS/Hermes 번들 **1,384모듈/3.8MB** 종료0 (`output/android-manual-verified.log`). 모바일110개는 순수/API101+도구9다.
- 최종 PC core Playwright **19개/53.1초/종료0** (`output/android-manual-pc-verified.log`). 합성 인증·실제 로컬 Next/NestJS/폐기용 DB로 생성 멱등·PC 조회/편집 제한·시각 보존·세션 만료를 검사했다. Android라는 테스트 이름은 native HTTP 경로를 뜻하며 실제 APK 실행 시험이 아니다.
- 최종 검증 뒤 코드 변경은 없고 이 문서/계획/Notion 결과만 갱신했다. 독립 리뷰 뒤 보완은 작성자의 실패 재현→회귀 통과 근거이며 두 번째 독립 승인으로 표현하지 않는다.
- 화면/모델/공유 fixture를 역할별로 분리해 약34파일이 이번 단위에 포함된다. DB/API/PC 제품 코드 변경 없음. DB 시험 패키지의 공용 계약 의존성과 lockfile은 갱신했다.
