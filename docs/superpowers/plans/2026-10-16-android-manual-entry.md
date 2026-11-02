# Android Manual Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Android에서 선택형 참조·명시 시각의 수기 거래를 안전하게 작성하고 같은 서버 장부에 반영한다.
**Architecture:** 기존 HTTPS native BFF, SessionManager의 인증 세대 검사, 순수 입력 모델, 메모리 저장 시도 controller, 기존 Bookify 화면 토큰을 연결한다.
**Tech Stack:** TypeScript, React Native/Expo, ky, Zod, 기존 NestJS/PostgreSQL.
**Spec:** docs/superpowers/specs/2026-10-16-android-manual-entry-design.md

## Global Constraints

- 계좌·카테고리 미지정 허용. 원화 양의 안전 정수. PC 신규 작성 금지.
- UI에 credential/DB 키 없음. 자동 retry0. 미완료 금융 자료는 메모리만 사용.
- 날짜-only에 자정 생성 금지, 거주 기준 자동 변경 금지.
- Android 먼저, APK/실기기·배포 완료와 JS build 구분.
- mixed worktree를 보존하고 이 계획에서는 stage/commit/push하지 않는다.

## Review Focus

1. 로그인 전 요청·로그아웃/계정 전환 뒤 늦은 결과 차단: Task1 guard tests.
2. 저장 성공 뒤 응답 유실·중복 탭·같은 키 다른 입력: Task2 상태 테스트.
3. 숫자 소수/지수/비정상 쉼표·보관/다른 방향 분류: Task2 입력 테스트.
4. DST gap/overlap·여행/영구 변경·날짜-only: Task2 시간 테스트 및 Task4 실기기 게이트.
5. background 때 민감 화면 가림과 동일 계정 시도 유지: Task3 lifecycle 검증.

## Task 1: native API/인증 경계

Files: 새 apps/mobile/src/api/native-ledger-client.ts, native-ledger-client.test.ts, auth/session-ledger.test.ts; 수정 native-client.ts, auth/session-manager.ts, 기존 session-manager.test.ts fixture.
Consumes: 공용 Profile/AccountList/CategoryList/CreateTransaction/Transaction schema.
Produces: NativeClient.ledger.profile/updateProfile/accounts/categories/createTransaction(token,input), SessionManager의 같은 이름 토큰 없는 public 메서드.

- [x] HTTP 실제 Request/Response RED: 고정 경로·PATCH/POST·strict spoof 거부·nullable 참조·5xx 재시도 없음.
- [x] SessionManager RED: signed_out network0, late success/logout 차단, current401 처리, 기존 old-token401 보존 회귀, profile owner mismatch.
- [x] NativeLedgerClient(callback)와 private authenticatedRequest<T>(operation) 구현, 기존 transactions 경로도 같은 guard 재사용.
- [x] mobile 전체 test/typecheck GREEN. Expected: 새 경계와 기존 세션 회귀 모두 통과.

## Task 2: 입력·시간·저장 상태

Files: 새 apps/mobile/src/ledger/manual-input.ts, manual-time.ts, manual-entry.ts 및 각 test.ts; 필요시 package/lockfile.
Consumes: Task1의 토큰 없는 API 및 공용 계약.
Produces: 정규화 입력, 명시 시각 변환 결과, subscribe/snapshot 기반 수기 저장 controller.

- [x] 합성 수기 입력/참조/DST/unknown time fixture로 RED.
- [x] payload 정규화와 명시 시간 변환, 시도당 UUID 고정·명시 retry·in-flight 공유 구현.
- [x] 네트워크 실패 뒤 같은 키, 편집 잠금, success 상태, account disposal 시험 GREEN. 목록 refresh 연결은 Task3 UI 소유다.

## Task 3: Android 화면 연결

Files: 새 ui/manual-entry-screen.tsx, manual-entry-fields.tsx, residence-screen.tsx; 수정 app/index.tsx, ledger-screen.tsx, ui 표시·오류, core tsconfig/README. 필요시 작은 역할별 hook 추가.
Consumes: Task2 상태 모델, Task1 API, 기존 Bookify 토큰.

- [x] 기존 UI/디자인 지침·원본 참조 확인, 입력 상태/변경 lifecycle 검사 작성.
- [x] 목록 작성 진입·프로필 기준·선택 참조·저장·재조회 연결.
- [x] 모바일 typecheck/build, 기기 가능 여부 확인. 기기 미확보를 화면 검증 통과로 바꾸지 않음.

## Task 4: 통합·리뷰·문서

- [x] 전체 pnpm verify·DB/PC Playwright 해당 경로 확인·git diff --check·의존성/비밀 패턴 점검.
- [x] fresh reviewer1회, 차단 지적 RED→GREEN 한 pass. 전체 혼합 PR 리뷰는 별도 남겨 범위를 명시.
- [x] 상태 MD/통합 설계/Notion 기능별 기록·readback.

## 실행 원장

BASE8af7a0d, feature/bank-state-transitions linked worktree 확인. 직전 상태 보고에서 최종 verify99358 종료0을 확인해 선행 API 계획을 마감했다.
Pre-flight: Task1 public guard가 Task2/3의 유일 API 통로. Task2의 immutable attempt를 Task3가 background 때 보존하고 계정 변경 때 폐기해야 한다. profile id는 인증 사용자와 대조한다.
Ruling: 반복 승인 없이 진행하라는 사용자 지시를 적용해 승인된 정책의 상세 계획을 inline 실행한다. 새 권한/외부 배포 결정은 포함하지 않는다. 오판 시 범위 확장이므로 현 범위를 문서/채팅에 먼저 알린다.
Ruling: autoplan 참조와 qa-only 보조 템플릿의 기존 누락은 직접 체크리스트·TDD·읽기 전용 보안 검토·Playwright·fresh review로 보완한다. 완전한 자동 파이프라인 실행을 주장하지 않는다.
- Task1 complete: 새 API/guard13개 RED→GREEN, 모바일61개(52vitest+9도구)·엄격 타입 검사 종료0. 출력 android-manual-api-{red,epoch-red,green}.log. 미커밋 작업이다.
- Task1 결함: foreground 재검증 이전에 보낸 성공 응답이 검증 후 반환되는 상황 RED 재현. verificationEpoch도 비교해 SESSION_CHANGED로 차단했다. 테스트용 LEDGER_UNAVAILABLE 오기는 실제 공용 LEDGER_SERVICE_UNAVAILABLE로 바로잡았으며 제품 오류 계약은 바꾸지 않았다.
- Task2 complete(모델): 새35개, 모바일 전체96개(87vitest+9도구) GREEN. 날짜-only/null 참조·금액·서울/카트만두·DST gap/overlap·분 정밀도·네트워크/5xx/판독 실패·멱등 conflict·중복 탭·계정 dispose 포함. 실제 화면/lifecycle 연결은 Task3에 남는다.
- Task2 Ruling: 시각 변환은 직접 DST 계산 대신 @js-temporal/polyfill0.5.1과 jsbi4.3.2를 잠금 파일에 고정했다. 공식 문서의 earlier/later 결과를 원래 벽시계와 대조해 gap을 거부하고 overlap을 사용자 선택으로 돌린다. 비용은 의존성과 네이티브 Intl/tzdb 호환 확인이다. 현재 순수 Node 시험만으로 Hermes 호환을 주장하지 않는다.
- Task2 Ruling: 서버 응답을 확실히 받지 못했으면 새 키/내용으로 재전송하지 않고 같은 요청만 명시 재시도한다. 목록 확인 후 새 입력을 선택하는 API는 UI에서 명확한 안내·확인과 연결해야 한다. 잘못 연결하면 중복 기입 위험이 있으므로 Task3/최종 리뷰 핵심이다.
- 감사: pnpm audit high2 종료1, 기존 node-forge/braces. patched_versions가 >=1.4.1/>=3.0.4로 표시돼 레지스트리까지 확인했으나 두 버전 모두 PACKAGE_NOT_FOUND. 경고를 무시하거나 제3자 fork로 바꾸지 않는다. 새 Temporal 의존성 지적 없음. SDK/JDK/adb 표준 경로/PATH 없음 재확인; 실기기 단계는 미완료다.
- 등록 비밀 패턴863파일/0건, diff --check 종료0. 기존 CRLF 정규화 경고만 존재. 최종 verify 세션21997 진행 중, 전체 계획/리뷰/배포 완료 아님.
- 세션21997 종료0 확인. Task3 소스 연결 후 모바일106개와 전체 verify2,126개/Android 번들3.8MB 종료0. 해당 결과는 아래 리뷰 보완 전 기준이다.
- Task3 complete(소스/검사): 화면7개 역할 분리와 기존 목록/앱 연결, workspace lifecycle10개 추가. native 캡처·APK 시험은 미완료. 기능 전체 완료로 확대하지 않는다.
- Final review: fresh context1회. Critical0/Important2/Minor1. 목록 GET 시작 전후와 불확실 재시도 세대, 현재/당시 거주 시간대 차이가 Important였다. 각각 실제 실패 RED→GREEN. 계정 전환 뒤 residence callback 화면 이동은 Minor에서 Important로 올려 마지막 await/화면 세대 검사를 같은 pass에서 보완했다.
- Final Ruling: 서버 시간대 이력 계약은 유지하고 과거 거래의 당시 거주 시간대를 선택 입력으로 받는다. 현재 기준을 역사적 사실로 단정하지 않는다. 비용은 이사 전 입력의 추가 단계이며, 틀린 입력은 서버가 거부한다.
- Final Ruling: native 화면 캡처/키보드/Back/TalkBack/최근 앱 미리보기·Hermes tzdb·APK·알림 listener·전체 혼합 PR/운영 감사는 증거 부재 또는 범위 밖으로 남긴다. 기기 없이 시각 검증을 통과로 바꾸면 사용자 데이터/접근성 위험을 놓칠 수 있다.
- Final Ruling: DB 테스트에서 모바일 소스를 직접 import하면 CJS/ESM 타입 경계가 충돌했다. 엄격 검사를 유지하고 합성 wire fixture를 양쪽이 대조하도록 분리했다. 비용은 UI부터 DB까지 하나의 실행으로 검증하지 못하는 점이며 실기기 게이트를 유지한다.
- 감사 재확인 high2/moderate0/critical0 종료1. 기존 node-forge/braces, 해결/예외 추가 없음. 최종 verify/DB/PC와 문서 readback은 진행 중이다.
- Final Ruling: UI/model/fixture 역할 분리로 예상18~25파일에서 약34파일로 늘었다. DB/API/PC 제품 동작은 그대로이며 DB 시험에 공용 계약 workspace 의존성을 명시했다. 비용은 파일 수 증가지만 큰 단일 파일과 비명시 전이 의존성을 피한다.
- DB 테스트 최종414개/37파일/47.91초 종료0. 직접 모바일 import의 ESM/CJS 충돌 후 공용 계약을 DB 테스트 의존성에 빠뜨린 오류도 발견해 명시 연결했다. 설치 스크립트 실행/새 외부 패키지 다운로드 없이 해결했고 타입/해당7개 시험 재통과 후 전체 DB를 재실행했다.
- 등록 비밀 패턴 재확인873파일/0건. env.local/keystore/Expo 캐시 ignore, git diff --check 종료0(기존 CRLF 안내만). 원시 비밀값을 보고서/Notion에 전송하지 않았다.
- 최종 2026-10-17 확인: pnpm verify2130개·린트·7 workspace 타입·API/웹 build·Android1384모듈/3.8MB 종료0; core PC Playwright19개/53.1초 종료0. 전체 command 세션47262 완료. DB414개는 별도 종료0. 로그 android-manual-{verified,db-verified,pc-verified}.log. 후속 코드 수정 없음.
- 범위 종료: 소스/자동 검증/범위 코드 리뷰 단위다. SDK/JDK/adb 표준 경로/PATH 미확보를 권한 제한 없는 읽기로 재확인했다. 네이티브 실행·시각 finish review, 보안 high2, 운영 이관·커밋/푸시·원격 CI·배포는 완료가 아니다. mixed 작업 보존을 위해 작업 원장/브랜치를 정리하거나 삭제하지 않는다.
- Task4 complete(명시 범위): README·상태·통합 설계·본 계획 갱신. Notion07 갱신 async succeeded 후 수기 절/2130/DB414/PC53.1초와 진행중 문구 제거를 fetch로 확인했다. 최종 diff --check 종료0. 코드 변경 없는 문서 마감이며 네이티브 게이트는 다음 작업으로 남는다.
