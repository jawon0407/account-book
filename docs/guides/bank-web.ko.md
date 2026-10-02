# 은행 연결 BFF와 PC 화면 — 초급 개발자 가이드

## 지금 사용할 수 있는 범위

로그인 후 `/app/bank-connections`에서 은행 연결 안내를 볼 수 있다. 공식 금융기관 설정을 아직 활성화하지 않았으므로 시작 버튼은 **준비 중**이다. 버튼을 개발자 도구로 활성화해도 BFF의 서버 설정이 null이므로 시작하지 않는다. 수동 장부 계좌와 실제 은행 연결은 서로 다른 기능이다.

A4는 화면과 안전한 연결 경계를 만들었다. 공식 인증·잔액·입출금 수집이나 송금이 구현된 것은 아니다. A5는 가상 공급자 전체 통합, A6는 공식 명세·테스트 자격·Callback·secret을 확인한 후 금융결제원 테스트다.

## 데이터가 움직이는 순서

```text
PC 시작 버튼 → ky/CSRF → Next BFF(현재 세션 + 확인값 생성)
                         ↓ 확인값 해시 + 위임 JWT
                      Nest API → 은행 동의 화면
                                   ↓ Callback
                      API 임시 코드 저장 → PC 결과 화면(requestId만)
PC 연결 확인 → BFF(현재 세션 + HttpOnly 확인 쿠키) → API 단일 교환
PC 상태 조회 ← 공개 상태만 반환 ← API 암호화 저장
```

`requestId`는 작업 번호다. 번호를 안다고 남의 연결을 조회할 수 없다. BFF는 세션을 DB에서 다시 읽고 API는 소유 사용자·시작 세션·요청 상태를 다시 검사한다. 은행 토큰을 PC로 보내지 않는다.

## 각 파일의 책임

| 위치 (`apps/web/src/` 기준) | 역할 |
| --- | --- |
| `server/bank-connections/bank-controller.ts` | start/complete/status 입력과 API 응답을 검사하고 한 번 위임한다 |
| `server/bank-connections/bank-boundary.ts` | 로그인·Origin·CSRF·현재 계정, 허용 인가 URL, 공개 오류를 검사한다 |
| `server/bank-connections/proof-cookie.ts` | 독립 난수 생성·해시·쿠키 직렬화/중복 검사·삭제를 담당한다 |
| `server/bank-connections/route-adapter.ts` | Next 요청을 작업별 컨트롤러로 연결하고 설정 오류를 숨긴다 |
| `app/api/bank-connections/` | Node.js 런타임의 고정 HTTP 경로다. 임의 upstream 주소를 받지 않는다 |
| `features/ledger/bank-connections/api.ts` | ky로 BFF만 호출하고 요청/응답 계약을 검증한다 |
| 같은 폴더 `start-page.tsx`, `result-page.tsx` | 시작 안내와 결과 확인·불확실한 결과의 조회 동작을 구분한다 |
| 같은 폴더 `status-copy.ts`, `bank.module.css` | 공개 상태의 한국어 설명, 기존 장부 간격/타입 재사용 |
| `app/app/bank-connections/result/page.tsx` | 비동기 searchParams에서 requestId 하나만 허용한다 |

## 주요 함수와 매개변수

- `BankController(dependencies)`: 기존 세션 서비스·서버 CSRF 키·위임 클라이언트·허용 endpoint를 받는다. 마지막 설정이 null이면 시작 비활성이다. 브라우저에서 설정할 수 없다.
- `handle(operation, request, requestId?)`: 작업은 start/complete/status 중 서버 라우트가 고른 값이다. Request는 쿠키·Origin·CSRF를 포함한다. 마지막 ID는 status 경로에만 사용한다.
- `bankIdentity(deps, request)`: 세션 쿠키가 정확히 하나인지, 변경 요청에 CSRF가 맞는지 검사한다. 사용자 ID는 요청 body가 아니라 현재 세션에서 가져온다. 화면이 열린 뒤 계정이 바뀌면 헤더의 추가 일치 조건으로 거부한다.
- `createProof()`/`proofDigest(proof)`: 32바이트 난수를 만들고 원본 바이트를 SHA-256으로 변환한다. 해시를 알고 원본을 복원할 수는 없다.
- `readProof(request, requestId)`: 쿠키를 한 개만 허용하고 대상 ID가 다르거나 난수가 비정규 형식이면 중단한다.
- `createBankApi(userId, http?)`: userId는 화면의 계정이 바뀌지 않았다는 추가 조건이며 로그인 권한 자체가 아니다. http는 ky 전송 경계다. start는 빈 JSON, complete는 requestId만 보내며 proof를 읽지 않는다.

## 확인 쿠키는 왜 필요한가

공급자 `state`만으로는 ‘이 브라우저에서 시작한 내 연결’임을 충분히 확인하지 못한다. BFF는 별도의 `__Host-ab_bank_proof`를 HttpOnly·Secure·SameSite=Lax·Path=/·5분으로 저장한다. JavaScript는 읽을 수 없다. 원본은 API에 전달하지 않고 해시만 전달한다.

쿠키에는 요청 ID와 난수가 있지만 쿠키 자체가 권한은 아니다. 최종 판정은 API DB의 요청 ID·사용자·세션·해시·서버 만료다. 쿠키를 변조하거나 만료 속성을 바꿔도 서버 만료를 늘릴 수 없다. 단일 쿠키이므로 여러 탭에서 새 연결을 시작하면 이전 흐름이 실패할 수 있다. 이는 중복 연결보다 안전한 실패를 택한 정책이다.

완료 POST를 보낸 뒤에는 결과가 성공인지 알 수 없더라도 proof 쿠키를 지운다. 화면은 같은 코드를 자동 재전송하지 않는다. 상태 조회로 성공이 확인되면 이전 실패 안내를 숨긴다. 상태가 계속 불확실하면 새 연결을 시작한다. 서버 API의 원자적 claim도 한 번의 교환을 보장한다.

## 시간 제한과 저장 정책

은행 API 외부 교환은 최대8초다. 이 고정 complete POST에만 BFF12초, 브라우저 은행 요청15초, Next handler20초를 둔다. 일반 위임 API의3초는 바꾸지 않았다. 요청을 재시도하는 것과 결과를 조회하는 것은 다르다.

BFF JSON은 `private, no-store`와 `no-referrer`, UI는 동적 렌더링과 no-referrer다. Next 개발 서버는 페이지 Cache-Control을 자체 값으로 덮어쓸 수 있으므로 production 응답을 별도로 검증한다. 은행 데이터는 SSR HTML에 넣지 않고 인증된 BFF로 읽는다. React Query는 현재 계정별 메모리 캐시만 쓰고 localStorage/sessionStorage에는 저장하지 않는다.

## 검증을 해석하는 법

Vitest에서는 실제 BFF·ky·React 화면을 실행하고 DB/외부 HTTP만 격리한다. PC Playwright의 합성 상태 응답은 사용자 화면 검증용이지 은행 통신 성공 증거가 아니다. 실제 BFF/API/DB/Callback 전체 연결은 A5의 별도 완료 조건이다. 이번 결과는 [A4 진행 기록](../status/2026-10-02-bank-web.ko.md)을 참고한다.
