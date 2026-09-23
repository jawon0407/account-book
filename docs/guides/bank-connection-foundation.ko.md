# 은행 연결 공개 계약 안내

현재 `@account-book/contracts`는 브라우저에 공개할 은행 연결 요청 상태의 모양만
검사한다. 서버와 DB를 통한 연결 요청 생성·조회는 아직 연결되지 않았다.

## 공개 상태

`BankConnectionRequestStatusSchema`는 아래 두 필드만 허용한다.

- `requestId`: 내부 요청의 UUID 식별자
- `status`: `awaiting_callback`, `awaiting_completion`, `exchanging`, `connected`,
  `cancelled`, `expired`, `failed` 중 하나

스키마는 알 수 없는 필드를 거부한다. 따라서 `accessToken`, `refreshToken`, 인가
`code`, `state`, `proof`, `userId` 같은 값은 브라우저 상태 응답에 포함할 수 없다.
내부 DB 상태·실패 사유·장애 세부값을 이 상태 목록에 그대로 노출하지 않는다.

## 식별자와 권한은 다르다

ID는 찾아가는 번호일 뿐, 내 자료인지 확인하는 검사는 별도다. UUID 형식이 맞아도
소유권을 증명하지 않는다. 실제 요청 조회가 구현되면 서버가 인증 과정에서 얻은
principal을 사용해 사용자 범위의 소유권을 별도로 확인해야 한다.

이 계약은 은행 연결 인증 기반 완료를 잔액·거래 수집 완료와 구분한다. 송금·이체·출금은
범위 밖이며, 은행 비밀값과 접근·갱신 토큰은 API 서버 경계 안에만 두어야 한다.

## 현재 진행 상태

공개 상태 계약과 런타임 검증만 구현되어 있다. 연결 요청을 보관하는 DB 테이블,
HTTP endpoint, 은행 provider 연동은 아직 없다. 작업 단위별 진행 사항은
[은행 연결 진행 기록](../status/2026-09-23-bank-connection-foundation.ko.md)에서 확인한다.
