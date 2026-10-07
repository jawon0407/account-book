# 개인 알림 가계부 클라우드 작업 인수인계

기준일: 2026-10-07. 제품 방향은 개인 휴대폰 금융 알림 기반 가계부이며, 선택형 자동 분류 규칙을 포함한다. **새 기능은 설계 단계다. 문서 업로드를 구현·DB 적용·출시 완료로 읽지 않는다.**

## 1. 먼저 읽을 자료

1. [최신 요구사항과 분류 정책](../superpowers/specs/2026-10-07-personal-notification-ledger-design.md).
2. [문서 지도](../README.md)와 [작업 사전 계획·검증 절차](../guides/change-workflow.ko.md).
3. [2026-10-07 Notion 개발일지](https://app.notion.com/p/3f1323168ba681ab9ae6c69129a8d69a).

최신 요구사항은 실계좌 API 대신 개인 알림·수기 기록을 우선한다. 예전 은행 후속 A5/A6, 공동 장부·라온·AI 분석은 보존/후속 범위다. 클라우드에서 이 순서를 다시 은행 API 우선으로 되돌리지 않는다.

## 2. GitHub에서 재개할 위치

- 저장소: [jawon0407/account-book](https://github.com/jawon0407/account-book).
- 문서 전송 대상: `feature/bank-state-transitions`.
- 문서 작업 전 코드 기준: `00ff1c15f38afbf150727e43a2848a41009b03a0`.
- 원격 `main` 확인값: `b7ecd830c3aefd9b225b100b1087d78d39e2ddc1`.
- 기존 [PR #22](https://github.com/jawon0407/account-book/pull/22)는 확인 당시 OPEN이며 base는 `main`이다. 이번 요청은 문서 커밋·푸시이며 병합 요청이 아니다.

클라우드 작업 환경에서 저장소를 연결한 뒤 위 기능 브랜치를 선택한다. 기본 `main`만 열면 이 문서와 후속 코드가 없을 수 있다. Git을 직접 사용할 수 있다면 새 폴더에서 다음처럼 가져온다.

```sh
git clone --branch feature/bank-state-transitions --single-branch https://github.com/jawon0407/account-book.git
cd account-book
git status --short --branch
git log -1 --oneline
```

브랜치와 최신 문서 존재를 먼저 확인한다. 이미 작업 중인 폴더에서 강제로 checkout/reset하여 변경을 버리지 않는다. 이 명령은 저장소 확보용이며 서버 실행·DB 연결·모바일 빌드를 완료하지 않는다.

## 3. 현재 구현과 새 목표의 차이

아래 코드 상태는 문서 작업 전 기준 SHA와 로컬 읽기 확인에 근거한다. 아래 표의 '재사용'은 이번 문서 작업에서 재시험했다는 뜻이 아니다.

| 영역 | 재사용할 현재 코드 | 필요한 후속 |
| --- | --- | --- |
| 웹 | 프로필·계좌·분류·일반 거래 조회/입력/수정/삭제 | 편집 중심 전환, 다중 필터, 미분류/자동분류 근거 표시 |
| 계약/API | 사용자 소유 검증, 일반 거래 생성·수정, 재시도 키·버전 충돌 | 시간·출처·다중 조회, 모바일 인증, 수집/분류 규칙 경계 |
| 거래 데이터 | 날짜 `occurred_on`, 필수 수입/지출 카테고리 | 시각 정밀도·미분류 시스템 분류·수집 연결·변경 이력 |
| 모바일 | React Native/Expo 방향 문서 | `apps/mobile`과 Android 네이티브 수집 신규 |
| 분류 자동화 | 이번에 합의한 제품 요구사항 | 조건 저장·실행·충돌 처리·미분류 안내 모두 미구현 |

현재 원장 이름은 `user.users`, `user.roles`, `user.role_history`, `finance.accounts`, `finance.transaction_categories`, `finance.transaction_history`, `finance.account_transfers`, `finance.request_deduplication`이다.

같은 날 앞선 읽기 전용 개발 DB 점검에서는 이 8개 테이블의 RLS/FORCE RLS와 기존 역할 접근 검사 19개 통과를 기록했다. 이는 이번 문서 커밋에서 새로 실행한 검사가 아니며 새 모바일/알림 기능의 보안 보증이 아니다. 당시 `app_bank` 테이블은 실제 개발 DB에서 확인되지 않았다. SQL 파일 존재와 실제 적용을 구별한다.

## 4. 로컬에만 남아 있는 작업

기존 개발 작업 트리에는 A5용 API/Web 가상 런타임, E2E 설정·은행 테스트, 은행 통합 문서의 미커밋 변경이 있다. **이번에는 그 작업을 커밋하지 않는다. 클라우드 clone에 따라오지 않는다.** 후속 은행 테스트를 재개할 경우 별도 인계가 필요하다.

대표 경로: `apps/api/src/bank-connections/testing`, `apps/web/src/server/bank-connections/e2e-runtime*`, `tests/e2e/bank`, `tests/database/support/bank-e2e-database.ts`, 은행 관련 모듈/컨테이너/E2E 설정 변경. 루트 checkout에도 무관한 API 진입점 변경이 있으므로 보존한다.

사용자 PC의 `.env`, 인증서, DB 연결 파일, 개인 캡처는 GitHub에 올리지 않는다. 클라우드에서 로컬 localhost 서버나 Windows 비공개 설정을 사용할 수 있다고 가정하지 않는다. 필요한 테스트 값은 승인된 클라우드 secret 경로와 폐기용 DB로 별도 준비한다. 실제 Android 기기의 알림 권한/백그라운드 검증은 실기기 또는 적절한 테스트 환경이 필요하다.

## 5. 바꾸면 안 되는 최신 결정

- 자동 분류 규칙 생성·활성화는 선택 사항. 규칙 없이도 앱의 기본 기록·조회 가능.
- 목적만 미분류인 거래는 입출금 합계에 포함하고 미분류 안내. 계좌·금액 불명확/중복 후보는 별도 확인대기.
- 첫 분류가 자동 규칙 생성 동의는 아님. 개인은 이전 분류를 제시해 매번 확인하는 흐름이 기본.
- 업체·기관의 자동 분류도 사용자별 명시적 선택. 계좌·방향·대상에 선택적 요일/시간/금액 조건.
- 거래 시각 우선. 거래 시각 미상일 때 수신 시각 대체는 기본 꺼짐·규칙별 선택. 서버 도착 시각 사용 금지.
- 미분류 알림은 상세 금융정보를 기본 숨김. 묶음 안내·앱 내 건수·자기 알림 재수집 방지.
- 조회 계좌/카테고리는 복수, 기간은 최대 한 방식. 기본은 전부 미선택으로 전체 조회.
- 사용자 정정은 자동 처리보다 우선. 실제 사용처 확인·누락 없는 전체 거래 수집·은행 실잔액을 보증하지 않음.

## 6. 다음 개발 단계와 검증

1. 상세 DB/모바일 인증/보관·삭제/오류 계약/PC 편집 권한 명세를 완성한다.
2. 실제 변경 파일·규모·대안·보안·테스트를 제시하고 실행 계획으로 나눈다.
3. 공용 계약·DB 추가형 migration·모바일 인증·기본 앱부터 연결한다.
4. 수집·미분류 원장 반영 → 선택형 규칙 → 안내 → PC 편집·동기화를 구현한다.
5. 단위·계약·폐기용 DB 격리·API·PC Playwright·Android 실기기 검증을 수행한다.

실계좌 연동·운영 결제·기밀 공개·파괴적 DB 적용은 이 인계로 승인되지 않는다. autoplan 전체 검토·구현 계획이 이미 끝났다고 표시하지 않는다. 기존 migration 파일 수정이나 무조건적인 Supabase `db push`도 금지한다.

이번 변경 파일은 이 인계, 요구사항 문서, 루트 README, 문서 지도다. 문서 검증은 상대 링크·Git diff·공개 전 비밀정보 검사를 대상으로 한다. 제품 코드·UI·DB를 바꾸지 않으므로 이 문서 작업을 새 기능 테스트/Playwright 통과로 기록하지 않는다. 커밋·원격 전송의 최종 결과는 Git 이력과 Notion 최신 절에서 확인한다.
