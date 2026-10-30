# Android 수기 입력 선행 — 거래 시각 DB 저장

상태: 승인된 통합 설계 §8과 공용 시각 계약의 저장 계층 구현. Android 우선, iOS 후속.

## 범위와 보존

`finance.transaction_history`에 UTC 순간, 정밀도, 근거, 출처 시간대, 장부 시간대 snapshot을 추가한다. 기존 DATE/금액/ID/version/생성일은 갱신하지 않는다. 과거 행과 아직 날짜만 보내는 API는 `day / legacy_date / occurred_at=null`로 유지한다. 자정·서울 시간대를 임의로 채우지 않는다.

거주 기준은 `"user".ledger_time_history`에 사용자별 순번과 효력 시각을 추가형으로 보존한다. 첫 기준만 effective_from=null, 이후는 DB 시계 기준이다. 회원 가입 때 기기 위치로 자동 생성하지 않는다. 본인 프로필 행 잠금으로 동시 변경을 직렬화하며 API는 시간대만 INSERT할 수 있다. 순번·효력/생성 시각은 trigger가 결정한다. 같은 시간대로 연속 변경하거나 DB 시계가 직전 변경보다 전진하지 않으면 고정 오류로 거부한다(시간을 만들어 보정하지 않는다). 기존 이력 UPDATE/DELETE 권한은 없다. API 연결에서 profile version 충돌 검사는 다음 단위다.

## 무결성·보안

- IANA 지역/이름 또는 UTC만 허용한다. 약어·임의 offset·없는 이름을 거부한다. PostgreSQL 시간대 자료와 JS/Android 자료 차이는 뒤의 통합/실기기 시험 대상이다.
- 분/초/밀리초 정밀도와 UTC 값이 맞아야 하며 무한대·서기 1~9999년 밖은 거부한다.
- 시각 있는 새 행과 시간 관련 필드를 바꾼 행만 현지 날짜와 snapshot의 일치를 검사한다. 메모 수정/조회 때 과거 장부 날짜를 새 tzdata로 재계산하지 않는다.
- 시각 근거는 사용자/알림/수신추정이며 날짜-only는 사용자/과거날짜다. 수신추정을 실제 은행 발생 시각으로 승격하지 않는다.
- 새 함수는 모두 SECURITY INVOKER, 고정 search_path. 기존 owner/ACL/RLS는 보존하고 새 열의 INSERT/UPDATE만 app_api에 추가한다. 새 이력은 활성 본인 SELECT/INSERT만 허용하고 BFF·anon·authenticated·service_role에는 열지 않는다.
- 클라이언트가 이력/시간대를 권한 근거로 선택하는 API는 만들지 않는다. 실제 시각→이력 선택, 수신추정 확인, version/멱등성/정렬은 다음 API 단위에서 닫는다.

## 이번에 하지 않는 것

운영 DB 적용·전체 기존 원장 재계산·새 API/화면·cursor 변경·Android APK·iOS·commit/push/deploy. 시간 정렬용 인덱스도 실제 조회 계약과 함께 다음 단위에서 추가한다. 저장 계층 완료는 모바일 수기 입력 완료가 아니다.

## 검증

실제 폐기용 PostgreSQL에서 이관 전후 전체 기존 행 값·ACL 비교, DATE 호환, UTC/서울/LA 경계, 틀린 정밀도/시간대/날짜 거부, 소유권·탈퇴·문맥 누락·column GRANT, 이력 원자성/동시성·rollback을 검사한다. 전체 DB 회귀와 PC Playwright를 실행한다. 독립 리뷰로 CHECK의 NULL 우회 및 history lock을 확인한다.

근거: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [열 권한](https://supabase.com/docs/guides/database/postgres/column-level-security), [PostgreSQL 날짜 함수](https://www.postgresql.org/docs/17/functions-datetime.html).
