# A4 은행 연결 BFF·PC 화면 설계

기준: 승인된 10-A 설계, A3 API, 사용자 2026-10-02 A4 진행 요청. 반복 승인 없이 기존 범위를 진행한다.

## 선택과 범위

- 선택: 은행 전용 얇은 BFF + 기존 세션/CSRF·위임 클라이언트 재사용. 쿠키 업무를 장부 CRUD 표에 섞지 않아 유지보수가 쉽다.
- 대안: 기존 CRUD 컨트롤러에 은행 특례 삽입은 파일 수가 적지만 쿠키/상태 규칙이 혼재한다. 새 인증 계층 구축은 독립적이나 보안 규칙이 중복된다.
- NestJS/DB/공급자 호출 규칙은 A3 그대로다. 새 DB migration, 실제 금융결제원 호출·송금·모바일 UI는 범위 밖이다.
- 공식 endpoint 검증·어댑터·secret은 A6. 이번 런타임은 시작 비활성, 테스트에서만 허용 endpoint를 주입한다. 가상 성공을 실제 연결처럼 보이지 않는다.

## 신뢰 경계

1. POST `/api/bank-connections/kftc/start`는 빈 JSON만 받는다. 세션 쿠키 중복/형식, Origin/Fetch Metadata, CSRF, 현재 세션과 화면 사용자 일치·접근 토큰 잔여 60초를 검증한다.
2. BFF가 독립 32바이트 proof를 만든다. API에는 SHA-256 해시와 `channel:web`만 보낸다. 사용자/세션은 서버에서 정한다.
3. 시작 응답의 정확한 UUID·허용 HTTPS origin/path·단일 표준 state를 검증한다. 쿠키는 `__Host-ab_bank_proof=requestId.proof`, HttpOnly/Secure/SameSite=Lax/Path=/, Max-Age=300. Domain 없음. 원본 proof는 JSON·URL·JS 저장소에 없다.
4. 쿠키 자체는 권한이 아니다. API DB의 requestId+userId+sessionId+proofDigest 결속과 서버 만료가 최종 검증이다. 쿠키를 변조해 만료를 늘려도 DB 조건을 통과하지 못한다. 새 시작은 한 개 쿠키를 대체하며 이전 탭은 안전하게 실패한다.
5. 결과 화면 `/app/bank-connections/result?requestId=UUID`는 정확히 이 매개변수 하나만 허용한다. code/state/token을 UI에 반사하지 않는다. GET 상태 조회는 사용자·세션을 다시 검증한다.
6. `awaiting_completion` 상태에서 사용자가 ‘연결 확인’을 누르면 POST complete가 `{requestId}`만 받는다. 쿠키의 ID와 일치하는 proof 해시만 API에 보낸다. 외부 Callback GET이나 React effect는 코드 교환을 실행하지 않는다.
7. complete를 전송한 뒤에는 성공/실패/응답 유실 모두 해당 proof 쿠키를 지운다. UI는 자동 재전송하지 않고 상태 조회만 제안한다. 늦은 응답/새로고침/StrictMode에서도 API claim이 단일 교환을 보장한다.
8. BFF JSON/페이지는 private no-store·no-referrer. 상류 헤더/원문 오류를 복사하지 않고, 정해진 은행 오류·상태만 허용한다. 은행 토큰·code·session token은 브라우저에 없다.

## 시간·오류

기존 위임 제한은 3초이나 A3 외부 교환이 최대 8초다. 정확한 bank complete POST에만 12초, 브라우저 은행 요청에 15초, Next route maxDuration 20초를 적용한다. 다른 API는 3초 유지. 지연/유실 시 자동 재시도 없음. 오류 400/401/403/404/409/429/503과 상류 계약 위반 502를 구분한다.

## 화면

기존 장부의 흰 패널·청록 버튼·760px 안내 폭·44px 행동·16px 그룹 간격을 재사용한다. 계좌 입력과 은행 연결은 별개임을 명시하고 은행 연결 메뉴를 추가한다. 준비 중/진행 중/성공/취소/만료/실패/세션 만료를 구분한다. 성공은 ‘연결 인증 완료’이며 잔액·입출금 수집 완료가 아니다. localStorage/sessionStorage에 상태를 저장하지 않는다.

## 검증

RED→GREEN: proof 형식/중복/ID 불일치, CSRF/세션/계정 교체, 정확한 위임 권한, 악성 URL/추가 필드/비정상 응답, 완료 재시도 금지·쿠키 삭제, 모든 상태 UI. 기존 전체 회귀·타입·lint·build 및 PC Playwright로 실제 로컬 페이지의 비활성/잘못된 복귀/로그인 경계를 검증한다. 합성 브라우저 상태 테스트와 실제 금융기관 테스트를 구분한다. A5에서 DB→Callback→브라우저 전체 가상 여정을 연결한다.
