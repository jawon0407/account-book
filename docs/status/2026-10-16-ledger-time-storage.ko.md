# Android 수기 입력 선행 — 날짜·시각 저장 구조

## 현재 달라진 부분

Android 우선 순서는 유지한다. 이번에는 화면이 아니라 **모바일에서 입력할 거래 시각을 안전하게 저장하는 DB 구조**를 구현했다. 운영 Supabase에는 적용하지 않았고, 합성 데이터가 든 폐기용 로컬 PostgreSQL에서 시험한다. 서버 API·PC 표시·Android 수기 화면 연결은 다음 단계다.

## 초급 개발자용 테이블 설명

### `finance.transaction_history` — 실제 돈의 이동

기존 금액·입출금 구분·거래 상대명·계좌·카테고리·날짜는 그대로다. 아래 열 다섯 개를 추가한다.

| 열 | 뜻 | 합성 예시 |
| --- | --- | --- |
| `occurred_at` | 실제로 알고 있는 UTC 순간. 날짜만 알면 비움 | `2026-10-16T06:53:00.000Z` |
| `time_precision` | 어느 단위까지 아는가 | `minute`: 분까지만 앎 |
| `time_source` | 시각 근거 | `user`, `notification`, `device_received`, `legacy_date` |
| `source_time_zone` | 원래 시각을 해석한 시간대. 모르면 비움 | `Asia/Seoul` |
| `ledger_time_zone` | 이 거래의 장부 날짜에 적용한 기준 | `Asia/Seoul` |

위 예시에서 장부 날짜 `occurred_on`은 10월 16일이다. `00초`는 분 단위 구간을 표현하는 값이며 실제 발생 초를 알아냈다는 뜻이 아니다. `device_received`는 수신 시각 추정이고 은행이 증명한 거래 시각이 아니다.

기존 날짜-only 거래는 시각을 비우고 `day / legacy_date`를 사용한다. 자정을 임의로 만들거나 금액·ID·version·생성 시각을 변경하지 않는다. 새 시각 저장과 시간 정정 때만 날짜 일치를 확인하므로, 메모 수정이나 조회 때문에 과거 날짜를 현재 시간대로 재계산하지 않는다.

### `user.ledger_time_history` — 회원이 선택한 거주 기준

사용자의 최초 선택과 이후 영구 변경을 기록한다. 여행지/기기 위치를 자동 수집하는 테이블이 아니다. 첫 설정 전에는 행이 없다.

| 열 | 뜻 |
| --- | --- |
| `user_id` | 이 설정의 소유자 |
| `revision` | 1, 2, 3… 변경 순번 |
| `time_zone` | 선택한 IANA 시간대 또는 UTC |
| `effective_from` | 적용 경계. 최초 기준만 비움 |
| `created_at` | DB가 기록한 생성 시각 |

API용 DB 계정은 본인의 `user_id`, `time_zone`만 추가할 수 있다. 순번·적용 시각을 임의로 보내거나 과거 이력을 수정/삭제하지 못한다. 같은 회원의 두 요청은 프로필 행 잠금으로 차례로 처리한다. 뒤 요청은 앞 요청이 성공했는지 또는 취소됐는지를 반영한다. 같은 기준을 반복 저장하거나 DB 시계가 전진하지 않은 변경은 거부한다.

## 코드 역할

| 파일 | 역할 |
| --- | --- |
| `supabase/migrations/20261016074408_ledger_time_storage.sql` | 새 테이블/열, CHECK, trigger, 행 소유권·열 권한을 함께 추가 |
| `packages/database/src/schema/ledger-time.ts` | `ledgerTimeColumns()`와 `ledgerTimeChecks(t)`: 시각 열과 정밀도 제약을 역할별 분리 |
| `packages/database/src/schema/ledger-time-history.ts` | 이력 테이블의 TypeScript/Drizzle 선언 |
| `ledger-transactions.ts`, `index.ts` | 기존 원장 선언에 새 열/제약·export 연결 |
| `tests/database/ledger-time-*.test.ts` | 실제 DB 저장/거부, 기존 행 보존, 동시성·권한 시험 |
| `tests/database/support/core-database.ts` | 새 이관을 기본 시험에 적용하고 과거 이관 시험에서는 명시적으로 제외 |
| `identity-schema.test.ts`, `core-parity.test.ts` | 네 번째 사용자 테이블의 FORCE RLS와 SQL/코드 선언 일치 검사 |

SQL 함수도 설명을 붙였다. `is_ledger_time_zone(zone)`은 허용 이름 확인, `guard_ledger_time_history()`는 사용자 잠금·순번·시각 결정, `guard_transaction_time()`은 새 시각 snapshot의 날짜 일치 검사다. 세 함수 모두 invoker 권한으로 실행한다. 기존 제한된 활성 회원 함수 외에 새 SECURITY DEFINER 우회는 추가하지 않았다.

## 시험·리뷰 기록

- 새 열/테이블이 없는 RED(12실패) → 새 저장·이력·이관 시험 38개 GREEN.
- 기존 FORCE RLS 기준 확대 후 누락 RED → 새 이력에도 FORCE RLS 적용.
- 전체 DB에서 이전 dist를 읽는 parity 실패 → 패키지 rebuild. 새 이력의 SQL/ORM FK 이름 차이도 시험으로 발견해 명시적으로 일치시켰다.
- 리뷰 전 전체 DB 394개/35파일 통과. 독립 읽기 전용 리뷰에서 Critical0/Important1/Minor0.
- Important: 최초 baseline의 effective_from이 비어 있어 시계 역행 검사가 빠졌다. 미래 baseline 합성 fixture로 잘못된 추가를 재현한 뒤 직전 created_at과 비교하도록 수정했다. 두 번째 변경 이후도 함께 검사한다.
- 리뷰 보완 후 전체 DB **396개/35파일/84.21초/종료0**. 새 저장 시험은40개이며 기존 parity에 새 테이블1개를 추가했다. 로그 `output/ledger-time-storage-db-reviewed.log`.
- 최종 `pnpm verify` 종료0: 린트·7 workspace 타입·2,051개 시험(legacy208 + 공용166 + DB단위19 + API318 + web1206 + mobile48 + preflight86), API/웹 build·Android JS/Hermes 번들1,369모듈/3.3MB. DB 통합396개는 verify의 단위 개수와 별도다. 로그 `output/ledger-time-storage-verify-final.log`.
- 공식 CLI 2.121.0 `db advisors --type security --fail-on error`: 로컬 합성 DB 지적0·종료0. 최초 연결은 TLS 없는 시험 DB라 실패했고, 고정 loopback URI에만 sslmode=disable로 재실행했다. 앱/운영 TLS 설정을 완화하지 않았다. CLI의 “remote database” 문구와 달리 검사 대상은127.0.0.1의 새 폐기용 fixture다. 로그 `output/ledger-time-storage-advisors-final.log`.
- PC core Playwright **18개/46.9초/종료0**. 합성 인증과 실제 로컬 BFF/NestJS/폐기용 DB에서 로그인·조회·편집·계정 격리·기존 Android HTTP 경계를 검증했다. 색상 환경변수 경고만 있었다. 로그 `output/ledger-time-storage-pc-e2e.log`. 전체 PR/운영 보안 승인으로 확대하지 않는다.

변경 규모는 제품5파일(새 SQL/TS3 + 기존 선언/export2), 시험6파일(새3 + 준비/기존 보안/parity3), 설계·계획·상태·통합 문서4파일, 총15파일이다. 새 제품143줄·새 시험229줄이며 기존 파일의 이번 변경은 작은 연결/기대값 갱신이다. 기존 다른 미커밋 diff는 이 숫자에 포함하지 않는다.

Notion 최상위·04 기술 구조·07 진행 상태에 이번 결과와 다음 단계를 반영했고, 비동기 저장 성공 뒤 다시 읽어 확인했다. 기존 공용 계약 단계와 새 DB 저장 단계를 구분하고 상단 상태표도 최신화했다.

## 안전 경계와 아직 남은 작업

1. 서버는 로그인한 사용자 이력을 읽어 발생 시점의 기준을 선택해야 한다. 클라이언트가 보내는 시간대 이력을 믿으면 안 된다. API profile version/멱등성/정렬·cursor는 다음 단위다.
2. 공용 함수의 256개 제한은 내부 계산량 제한이다. 평생 설정 변경 횟수 제한으로 삼지 않으며 관련 구간을 조회하는 API가 필요하다.
3. 기존 이체 쌍의 API는 DATE 기반이다. 시각 이체·시작 잔액은 별도 일관성/공수 검토 없이 이번 완료 범위에 넣지 않는다.
4. Android 입력 화면에서 DST 중복/없는 시각, JS·PostgreSQL·Android 시간대 자료 차이와 실제 기기 동작을 검증해야 한다.
5. SDK/JDK·APK·실기기, 알림 접근/판독/중복 처리, 필터·규칙·환불/복구·집계는 미완료다. JS 번들 통과는 APK 실행 성공이 아니다. iOS는 Android 승인 범위 구현·검증 뒤다.

이 단위에서 dependency/secret/environment 설정은 바꾸지 않았다. 기존 node-forge·braces 경고2건은 해결했다고 표시하지 않는다. 전체 autoplan 참조/QA 템플릿 누락 제한 아래 범위별 계획·시험·독립 리뷰를 수행했고 전체 PR/운영 침투시험 완료로 확대하지 않는다. 운영 DB 적용·배포·커밋/푸시는 하지 않았다.

설계와 계획: [저장 설계](../superpowers/specs/2026-10-16-ledger-time-storage-design.md), [실행 기록](../superpowers/plans/2026-10-16-ledger-time-storage.md). 보안 기준은 [Supabase 행 권한](https://supabase.com/docs/guides/database/postgres/row-level-security)과 [열 권한](https://supabase.com/docs/guides/database/postgres/column-level-security)을 대조했다. AI 보조 검토는 전문 보안 감사를 대체하지 않는다.
