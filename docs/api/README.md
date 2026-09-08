# API Documentation

## 현재 실제 실행 경계

Node API에는 상태 확인 `GET /health`와 인증 principal 조회 `GET /v1/me`가 있습니다. `/v1/me`는 BFF가 만든 짧은 위임 JWT를 API가 검증한 뒤 사용자 식별 정보를 반환합니다. 장부 내역을 조회하는 API가 아닙니다.

웹에는 인증·세션·복구·로그아웃·`/api/me`를 위한 14개 BFF route가 있습니다. [인증 운영 가이드](../guides/backend-auth-operations.ko.md)에서 route와 환경 설정을 확인합니다. 브라우저는 같은 출처의 BFF를 호출하고, BFF만 Heroku API를 호출합니다. 모바일 전용 인증 경계는 아직 구현되지 않았습니다.

## M2.1 공개 계약

packages/contracts가 다음 route 계열의 request/response 기준을 소유한다.

| Route family | 계약 |
| --- | --- |
| /v1/accounts | 금융 계좌 생성·수정·archive·목록·시작 잔액 |
| /v1/categories | 카테고리 생성·수정·archive·목록 |
| /v1/transactions | 수입·지출 생성·수정·삭제·cursor 목록 |
| /v1/transfers | 원자적 이체 생성 |

현재 route와 DB 구현은 아직 없다. 다음 계획에서 PostgreSQL/RLS를 먼저 구현한 뒤
controller를 연결한다. 모든 금융 response는 private, no-store를 사용하고 실제
오류는 ApiErrorSchema의 안전한 code만 노출한다.
