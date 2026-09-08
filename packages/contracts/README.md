# Contracts Package

Framework-independent runtime validation and TypeScript types for authentication inputs, current users, and public API errors. It contains no database or UI implementation.

초급 개발자에게 이 패키지는 “웹과 서버가 같은 양식으로 대화하게 하는 규칙집”이다. TypeScript 타입은 개발 중 실수를 찾고 Zod schema는 실행 중 외부 JSON을 검사한다. 함수 호출·입력 검증의 구체적인 예제는 [코드 읽기 가이드](../../docs/guides/code-reading.ko.md)에 있다. 금융 계약은 구현됐지만 이를 저장하는 API·DB는 아직 없다.


## 금융 공개 계약

계좌·카테고리·거래·이체 공개 요청과 응답은 package root에서 import한다. 생성 명령의
idempotencyKey는 재시도 작업 식별자이며 인증 수단이 아니다. 요청 body는 userId를
받지 않고 API가 검증한 principal에서 사용자를 결정한다.

- 금액: 양의 KRW safe integer
- 거래일: 실제 달력의 YYYY-MM-DD
- 생성: UUID v4 idempotencyKey 필수
- 리소스 UUID: `LedgerIdSchema`가 검증 후 소문자로 정규화한다. 계좌·거래·이체 ID의 대소문자 차이는 다른 리소스를 뜻하지 않는다.
- 수정·삭제: expectedVersion 필수
- 내부 delegated JWT 계약: @account-book/contracts/internal-api에서만 import
- 공개 오류 생성: `buildApiError`로 고정 메시지·UUID requestId·허용된 fieldErrors만 만든다.
- 신뢰되지 않은 오류 정규화: `sanitizeApiErrorInput`으로 안전한 공개 envelope를 만든다.
- 수신 오류 엄격 검증: `parseApiError`는 이미 정규화된 wire data만 검사하며 입력을 보정하지 않는다.

DB 소유권, category kind 일치, archive 상태, 멱등성 unique와 이체 원자성은 이
package가 증명하지 않는다. 후속 API·PostgreSQL 계층이 같은 공개 계약을 다시
검증하고 사용자 범위에서 비즈니스 불변식을 적용한다.

### UUID 비교 흐름

원본 요청/응답 → `Schema.parse` 또는 `safeParse` → 정규화된 `data` → ID 비교 순서로 사용한다.
이체의 출발·도착 계좌, 차변·대변 거래 ID, transferId 연결 검사는 정규화 이후 실행된다.
파싱 전 원본 문자열로 소유권·중복·동일 계좌를 판단하지 않는다. 인증된 사용자에 대한
소유권 검증과 DB의 UUID/복합 FK 제약은 이 문자열 정규화와 별도로 유지해야 한다.
멱등성 키는 작업 식별자이며 이번 리소스 UUID 정규화 변경의 대상이 아니다.
