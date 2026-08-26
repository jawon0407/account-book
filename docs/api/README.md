# API Documentation

## M2.1 공개 계약

packages/contracts가 다음 route 계열의 request/response 기준을 소유한다.

| Route family | 계약 |
| --- | --- |
| /v1/accounts | 계정 생성·수정·archive·목록·시작 잔액 |
| /v1/categories | 카테고리 생성·수정·archive·목록 |
| /v1/transactions | 수입·지출 생성·수정·삭제·cursor 목록 |
| /v1/transfers | 원자적 이체 생성 |

현재 route와 DB 구현은 아직 없다. 다음 계획에서 PostgreSQL/RLS를 먼저 구현한 뒤
controller를 연결한다. 모든 금융 response는 private, no-store를 사용하고 실제
오류는 ApiErrorSchema의 안전한 code만 노출한다.
