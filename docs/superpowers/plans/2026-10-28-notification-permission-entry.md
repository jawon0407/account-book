# 알림 허용 단일 진입점 — 설계 및 구현 계획

## 승인된 요구사항과 설계

사용자는 고정 출처 5종 목록 대신 ‘알림 허용’ 버튼과 사용자 선택 팝업을 요청했다. 기존 개발을 이어서 진행하라는 지시에 따라 한 단위로 구현한다. 이 문서가 이번 변경의 명세다.

- 버튼 → 앱 안내 팝업(취소 / 동의하고 설정 열기) → 서버 동의 확인 → Android 알림 접근 설정. 이미 최신 동의가 있으면 저장을 반복하지 않고 설정만 연다.
- 취소는 동의 저장·OS 이동 없이 끝난다. 저장 실패/불확정/늦은 응답/계정 변경에서는 설정을 열지 않는다. 연속 탭도 요청을 중복하지 않는다.
- 실제 OS 상태를 읽기 전에는 ‘허용됨’이라고 표시하지 않는다. 권한을 대신 켜지 않는다. 알림 표시 권한(POST_NOTIFICATIONS)으로 대체하지 않는다.
- 철회와 상태 재조회는 유지한다. OS 접근이 이미 켜졌다면 서버 장애 중에도 해제 설정으로 이동할 수 있다.
- 고정 출처 UI·저장 계층·관련 테스트 6파일 제거. 과거 개발용 저장값은 더 이상 읽거나 사용하지 않는다. 금융 원문은 저장했던 적이 없다.
- 실제 알림 본문 처리·분류·업로드·시작/중지는 이번에 구현하지 않는다. 고정 5종 제한은 없애지만 모든 형식 지원 완료로 표시하지 않는다.
- 신규 실제 수집 출시 전에 처리 범위에 맞춘 고지 버전을 다시 검토한다. 현재 동의를 모든 개인 알림의 무제한 저장 동의로 해석하지 않는다.

대안: OS 권한을 직접 켜거나 일반 알림 표시 팝업으로 대체하는 방식은 요구한 ‘다른 앱 알림 접근’과 다르므로 사용하지 않는다. 기존 네이티브 설정 이동을 재사용하는 앱 확인 팝업을 선택한다.

## Global Constraints

기존 feature/bank-state-transitions 작업 트리를 재사용한다. 서버·DB·Kotlin·의존성·PC 제품 코드 변경 없음. 사용자 해제 상태를 임의로 다시 켜지 않음. 커밋·푸시 없음. 테스트는 합성 계정과 로컬 서버만 사용한다.

## Task 1: 단일 진입점 구현과 검증

**Files:** notification-access.ts / notification-access.test.ts / notification-access-panel.tsx / notification-access-guide.tsx / collector-screen.tsx, 관련 설계·계획·상태·surface 문서. 출처 목록·모델·저장·패널 및 테스트 6개 제거.

**Interfaces:** NotificationAccess.requestAccess(): Promise<void>. 기존 accept/withdraw/reload 계약 유지. 내부 change는 작업 epoch 또는 null을 반환해 설정 이동 전 현재 작업인지 확인한다.

1. 테스트 먼저 추가: 동의 성공 뒤 이동, 이미 동의한 경우 재저장 없음, 실패 시 이동 없음, 중복 클릭 방지, stop/재로그인 뒤 늦은 응답 무시, OS 이동 실패와 허용 상태 분리.
2. `pnpm --filter @account-book/mobile exec vitest run src/collector/notification-access.test.ts`
   Expected: 새 requestAccess가 없어 신규 테스트 실패(RED).
3. 최소 상태 모델 구현, 고정 목록 제거, native Alert 팝업과 철회/설정 관리 경로 연결. 안내 문구를 선택 목록 없이 금융 알림 선별 방향으로 정정.
4. 같은 테스트 재실행.
   Expected: 기존 및 신규 테스트 통과(GREEN).
5. `pnpm --filter @account-book/mobile test`, 모바일 typecheck, 루트 lint, `pnpm test`, PC Playwright smoke 실행.
   Expected: 모두 종료 코드 0. 기존 제거 테스트 수와 신규 수를 분리 기록.
6. Android 연결 시 새 JS 번들로 버튼·팝업·취소·뒤로가기 확인. 사용자가 꺼둔 동의/OS 권한 유지. 기기 미연결이면 미검증을 명시.
7. 독립 코드 리뷰 1회, 결과 및 실제 검증 범위를 문서/Notion에 기록. 완료 후 미커밋으로 인계.

## Review Focus

서버 동의 실패에도 OS 설정으로 이동하는 경로, 늦은 응답/중복 탭/계정 변경, 철회 경로 손실, 실제 수집 오표시, 기존 source-preferences 잔존 호출, 팝업과 안내의 처리 범위 일치 여부.

## 결과

- [x] 고정 출처 목록/저장 및 테스트 6파일 제거, 알림 허용 팝업 연결.
- [x] 7개 신규 RED→GREEN, 모델 28개·모바일 238개·전체 2,311개 통과.
- [x] 모바일 typecheck, 루트 lint, Android JS/Hermes 번들, PC Playwright smoke 통과.
- [x] 독립 코드 리뷰: 차단 결함 없음. 리뷰 중 미완료였던 결과 기록은 예정대로 인계 전 작성.
- [x] USB 재연결 후 새 팝업 표시·취소/뒤로가기·동의 저장·OS 설정 왕복·사용자 허용 반영·기존 동의 중복 저장 없음·철회 후 재실행 유지 확인. 최종 서버 version 8/철회, OS 접근 꺼짐. 현재 휴대폰의 세로 화면·글꼴 기준이며 큰 글꼴/TalkBack/다른 OEM은 제외.

구현과 해당 휴대폰의 주요 실기기 흐름 확인 완료. 새 APK·실제 알림 수집은 이번 결과에 포함하지 않는다. 작업 트리를 미커밋으로 유지한다. 상세 증거는 status/2026-10-28-server-consent-device.ko.md 최신 절에 기록한다.
