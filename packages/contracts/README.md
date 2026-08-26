# Contracts Package

Framework-independent runtime validation and TypeScript types for authentication inputs, current users, and public API errors. It contains no database or UI implementation.


## 금융 공개 계약

계좌·카테고리·거래 공개 요청과 응답은 package root에서 import한다. 생성 명령의
idempotencyKey는 재시도 작업 식별자이며 인증 수단이 아니다. 요청 body는 userId를
받지 않고 API가 검증한 principal에서 사용자를 결정한다.

- 금액: 양의 KRW safe integer
- 거래일: 실제 달력의 YYYY-MM-DD
- 생성: UUID v4 idempotencyKey 필수
- 수정·삭제: expectedVersion 필수
- 내부 delegated JWT 계약: @account-book/contracts/internal-api에서만 import

DB 소유권, category kind 일치, archive 상태, 멱등성 unique와 이체 원자성은 이
package가 증명하지 않는다. 후속 API·PostgreSQL 계층이 같은 공개 계약을 다시
검증하고 사용자 범위에서 비즈니스 불변식을 적용한다.
