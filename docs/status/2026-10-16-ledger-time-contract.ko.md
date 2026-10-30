# Android 수기 입력 선행 — 거래 날짜·시각 계약

## 무엇이 달라졌나

**공용 코드에 시간 근거와 거주 시간대 선택 함수를 추가했다.** Android 수기 입력 화면이나 DB의 거래 시각 저장까지 구현한 것은 아니다. 현재 앱은 계속 날짜형 거래 목록을 사용한다. iOS는 시작하지 않았다.

현재 API/DB는 `occurredOn`/`occurred_on`이라는 날짜만 저장한다. 그래서 폼에 시·분만 먼저 추가하지 않고, 시각을 안전하게 저장하기 위한 공용 단위를 먼저 나눴다. 기존 날짜를 자정으로 바꾸거나 전체 거래를 새 시간대로 일괄 수정하지 않는다.

## 초급 개발자용 흐름

1. 알림 또는 사용자가 알려 준 시각의 근거와 정밀도를 검사한다. 이 함수는 알림 원문을 읽는 판독기가 아니다.
2. 이미 UTC 순간을 알고 있으면 당시 사용자의 거주 시간대 이력으로 적용 기준을 고른다. 현재 기기 설정이나 서버 접수일로 대신하지 않는다.
3. 기록 시간이 이사 시점을 걸치거나 수신 시각밖에 없어 확정할 수 없으면 확인 필요를 반환한다.
4. 기준이 정해지면 UTC 시각과 장부 날짜를 함께 만든다. 실제 DB 저장은 다음 단위에서 연결한다.

예를 들어 한국 거주자가 확인한 10월 16일 15:53 거래는 다음과 같은 값을 표현할 수 있다. `00초`는 분 단위 구간 시작 표기이며 실제로 0초에 발생했다고 주장하지 않는다.

```json
{
  "occurredAt": "2026-10-16T06:53:00.000Z",
  "occurredOn": "2026-10-16",
  "precision": "minute",
  "source": "user",
  "sourceTimeZone": "Asia/Seoul",
  "ledgerTimeZone": "Asia/Seoul"
}
```

날짜만 있는 과거 기록에는 `occurredAt: null`, `precision: day`, `source: legacy_date`를 사용한다. 아직 사용자 이력을 모르면 시간대를 임의로 서울로 채우지 않는다. `device_received`는 실제 거래 시각이 아닌 추정이라는 의미를 유지한다.

| 함수/계약 | 역할과 받는 값 |
| --- | --- |
| `preserveDateOnlyLedgerTime(date)` | 기존 달력 날짜를 검사하고 시각 없이 보존 |
| `TimedLedgerEvidenceSchema` | UTC 표기·정밀도·근거·출처 시간대 검사 |
| `selectResidenceTimeZone(evidence, history)` | 발생 시각과 소유자의 거주 이력으로 당시 기준 선택 또는 확인 필요 반환 |
| `buildTimedLedgerTime(evidence, ledgerTimeZone)` | 확정 기준으로 장부 날짜를 계산한 새 저장용 값 생성 |
| `LedgerTimeEvidenceSchema` | 새 날짜/시각 묶음의 일관성 검사. 과거 DB 행의 매 조회 재계산 용도가 아님 |

## 변경 규모와 리뷰

제품/시험은 새 `ledger-time.ts` 137줄, 새 시험 151줄, 기존 index에 이번 export 2줄이다. 모두 공용 패키지에만 있다. 설계·계획·이 상태 문서를 추가하고 통합 설계서의 현재 구현 요약을 바로잡았다. 기존 다른 미커밋 코드는 보존했다. 의존성·환경변수·실제 DB·기존 API/PC UI는 변경하지 않았다.

독립 범위 리뷰에서 Important 1건을 발견했다. Zod 배열의 `.max(256)`는 모든 항목을 검사한 뒤 크기를 거부하므로 자원 제한으로 불충분했다. 정상 정렬된 257개 이력에서 Intl 호출 257회를 재현한 뒤, 컨테이너 길이를 먼저 검사하도록 바꿨다. 새 회귀는 256개 수용·257개 거부·초과 시 Intl 0회를 검증한다. 전체 PR/운영 보안 감사가 아니라 이 모듈의 코드·입력 경계 리뷰다.

## 검증 기록

- 새 파일 부재 RED → 구현 후 공용 165개(새 41개) 통과.
- 리뷰 회귀 RED(257회 계산) → 수정 후 새 시간 계약 42개 통과.
- 리뷰 보완 후 최종 `pnpm verify` 종료 0: 린트·7 workspace 타입·2,051개 시험(legacy208 + contracts166 + DB단위19 + API318 + web1206 + mobile48 + preflight86), API/웹 build·Android JavaScript/Hermes 번들(1,369모듈/3.3MB) 통과. `output/ledger-time-verify-final.log`에 기록했다. 리뷰 보완 이전 첫 verify의 2,050개와 구별한다.
- PC core Playwright 18개·39.8초·종료 0. 합성 인증과 실제 로컬 BFF/NestJS/폐기용 DB를 사용했다. `output/ledger-time-pc-e2e.log`에 기록했다. 색상 환경변수 경고는 있었고 실패는 없었다.
- 이전 의존성 감사의 node-forge·braces 2건은 해결한 것으로 표시하지 않는다. 이 단위는 의존성을 바꾸지 않았고 재감사를 아직 수행하지 않았다.
- `git diff --check` 종료 0. 기존 파일의 CRLF 정규화 경고는 새 실패가 아니다. autoplan 필수 참조/qa-only 보고 템플릿 누락에 따른 전체 파이프라인 제한은 유지하며, 설치된 체크리스트·독립 범위 리뷰·기존 Playwright로 검증했다.

## 다음 작업과 남은 검증

1. 거주 이력과 거래별 시각 근거의 추가형 DB 이관, 소유권·최소 권한·이전 DATE 보존.
2. 서버 생성/수정/멱등 결과·정렬/cursor·PC 표시 연결. 클라이언트가 보낸 시간대를 그대로 권한 있는 사용자 이력으로 믿지 않는다.
3. Android 거주 기준 설정·수기 거래 작성·계좌/카테고리 선택. DST 중복/없는 현지 시각의 입력 처리는 아직 남았다.
4. SDK/JDK·APK·실제 Android 시간대 데이터/TLS/화면 검증. JS 번들 성공을 실기기 성공으로 취급하지 않는다.

배포·운영 DB 이관·커밋/푸시는 하지 않았다. 기존 미커밋 작업이 섞여 있어 범위별 기록을 먼저 보존한다. 사용자가 새 결정을 내려야 하는 정책 변경은 없으며, Android 승인 범위를 구현·검증한 후 iOS로 넘어간다.

Notion 최상위·04 기술 구조·07 진행 상태에 새 계약 범위와 검증 수치를 기록했고, 비동기 저장 성공 뒤 다시 읽기로 반영을 확인했다. 과거 시험 수치는 역사 기록으로 보존했다.

근거와 실행 계획: [설계](../superpowers/specs/2026-10-16-ledger-time-contract-design.md), [실행 계획](../superpowers/plans/2026-10-16-ledger-time-contract.md). [ECMA-402 공식 문서](https://tc39.es/ecma402/#sec-intl-datetimeformat-constructor)를 확인해 명시적인 시간대/ISO 달력 변환을 사용했다. 이 검토는 AI 보조 검사이며 전문 보안 감사·침투테스트를 대신하지 않는다.
