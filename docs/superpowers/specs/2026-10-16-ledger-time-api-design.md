# Android 수기 입력 선행 — 거래 시각 API 연결

## 범위

승인한 Android-first/거주 시간대 고정 정책을 기존 NestJS API에 연결한다. 이전 DB 이관의 후속이며 수기 입력 화면/알림 수집 자체의 완료가 아니다. 기존 미커밋 변경을 보존하고 운영 DB·배포·commit/push는 이번 단위에서 수행하지 않는다.

## API 계약

- `PATCH /v1/profile`: nickname 또는 ledgerTimeZone과 expectedVersion. 시간대는 서버/DB 모두 인식하는 IANA/UTC만 허용한다. 권한·소유자·효력 시각은 입력받지 않는다. 최초 선택 전 응답은 null. 같은 시간대 재선택은 이력을 늘리지 않는다. 닉네임과 시간대 변경은 같은 transaction/CAS로 처리한다.
- 거래의 기존 occurredOn과 날짜-only 호출을 유지한다. 선택 입력 `time`은 UTC occurredAt, minute/second/millisecond precision, sourceTimeZone만 받는다. 서버가 source=user와 당시 거주 시간대를 결정한다. 클라이언트가 source/ledgerTimeZone을 지정하지 못한다.
- 시각 입력은 거주 설정이 없으면 `LEDGER_TIME_SETUP_REQUIRED`(409), 정밀도 구간이 거주 변경을 걸치거나 장부 날짜가 맞지 않으면 `LEDGER_TIME_REVIEW_REQUIRED`(409). 추측/반올림으로 저장하지 않는다.
- 응답의 선택 필드 `time`은 저장 당시 날짜·순간·정밀도·근거·시간대 snapshot이다. 구버전 멱등 응답에는 없을 수 있고 소비자는 시간 미확인으로 취급한다. 조회 시 과거 날짜를 현재 시간대 자료로 다시 계산하지 않는다.
- memo/계좌/분류 등 수정 시 기존 time snapshot을 유지한다. 시각 거래의 날짜만 바꾸는 요청은 거부한다. 명시적 `time:null`+occurredOn은 사용자가 시각을 모른다고 정정하는 동작이다. PC에서는 별도 확인 선택 후에만 이 요청을 보낸다.
- 새로운 time 입력은 payload hash에 포함한다. 성공한 재시도는 이력/참조 재검사 전에 최초 snapshot을 반환한다. 기존 날짜-only 요청의 hash는 유지한다.

## 이력 선택·경쟁

수기 시각 저장은 본인 profile 행을 잠그고 발생 시각 직전(또는 최초 기준) 1행과 다음 변경 1행만 읽는다. 전체 이력을 자르지 않으며 256회 거주 변경 이후에도 동작한다. 선택한 직전 행은 공용 선택 함수의 구간 기준으로만 사용한다. profile 변경도 같은 행을 잠가 경쟁을 직렬화한다. 거래 수정은 거래 행→profile→새 계좌→새 분류, 생성은 멱등 행→profile→계좌→분류 순서다. profile 설정은 거래/멱등 행을 잠그지 않는다.

## 목록과 PC

장부 날짜 내림차순 → 실제/명시된 UTC 시각 내림차순(NULL은 해당 날짜 마지막) → UUID 내림차순. 날짜-only에 자정을 만들지 않는다. 커서 v2에는 날짜·nullable UTC·UUID·필터 결속값을 담는다. v1 커서는 명시적 검증 오류로 새 조회를 요구하며 새 정렬에 섞지 않는다. 기존 소유권/RLS는 커서와 무관하게 유지한다. 전용 partial index를 추가한다.

PC에는 저장 당시 시간대의 시각과 시간대 이름, 추정이면 추정 표기를 표시한다. 날짜-only는 `시간 미확인`. 정밀도보다 더 자세한 자릿수를 만들지 않는다. PC 신규 거래 생성 금지는 그대로다. 고급 시각 편집/DST 입력 UI는 Android 수기 입력 후속 작업에 포함한다.

## 검증 기준

계약 strict/위조 근거 거부, 프로필 CAS·rollback·타인 격리, >256 이력의 당시 구간 선택, 거주 변경 경계, 날짜 mismatch, 멱등 재시도, 기존 시각 보존, 명시적 날짜-only 정정, 시간/null keyset 페이지, PC 표기·수정 동의·실제 Playwright를 검사한다. 운영 이관/실금융 데이터/Android APK·기기 실행을 했다고 표시하지 않는다.
