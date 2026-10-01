# 프로필·계좌·분류 BFF 설계

## 목적과 승인 범위

사용자가 승인한 우선순위에 따라 기존 Nest API를 PC 화면에서 안전하게 호출할 수 있게 한다. 새 인증/DB 체계가 아니라 기존 세션·CSRF·요청별 위임 JWT를 재사용하는 서버 경계 확장이다. 별도 승인 없이 진행하라는 사용자 요청을 적용하며 이 문서와 파일별 계획을 먼저 기록한다. UI·은행·모바일은 후속 독립 작업이다.

## 방식 비교와 선택

- **선택: 별도 Core BFF 컨트롤러 + 고정 작업 표.** 10개 동작의 입력/출력/scope를 눈으로 대조할 수 있고 큰 AuthController를 늘리지 않는다. 공통 HTTP 경계의 작은 모듈이 필요하다.
- 기존 AuthController에 모두 추가: 초기 파일 수는 작지만 인증/금융 책임이 섞이고 700행 이상 파일이 더 커진다.
- 브라우저가 Nest 또는 Supabase를 직접 호출: BFF 세션·서버 전용 키 구조를 깨므로 제외한다.

## 요청과 응답

`/api/profile` GET/PATCH, `/api/accounts` GET/POST, `/api/accounts/[id]` PATCH, `/api/accounts/[id]/archive` POST, categories도 동일하다. 내부 대상은 각각 `/v1/...`이며 사용자 입력으로 호스트·scope·사용자 ID를 선택하지 않는다.

- nodejs runtime, force-dynamic, maxDuration 10초. 헤더/쿠키는 브라우저에 반환하지 않고 JSON만 재구성한다.
- 정확히 하나인 세션 쿠키를 검증하고 기존 SessionService.resolve로 확인한다. 조회 중 토큰 갱신/수명 연장 없음. 잔여 수명 60초 이하이면 기존 refresh-required 응답을 준다.
- POST/PATCH는 세션에 묶인 CSRF + 정확한 Origin + Fetch Metadata + JSON을 검사한다. 인증 POST 전용 함수의 기존 정책은 바꾸지 않고 별도 mutation 진입점만 추가한다.
- 요청 최대 16 KiB, 응답 최대 1 MiB, JSON 읽기 최대 3초. UTF-8/Content-Length/Content-Type/엄격한 공유 계약 검증. id는 UUID, 목록은 중복 없는 includeArchived=true/false만 허용한다.
- 본문을 검증/정규화하여 한 번 직렬화한 바이트를 서명·전송한다. 내부 fetch는 redirect:error, cache:no-store. 자동 재시도하지 않는다.
- 성공 상태는 생성 201, 나머지 200. 오류는 알려진 코드/상태 조합만 허용하고 그 외는 고정 502. 모든 응답 private,no-store. 역할/가입경로/탈퇴 필드는 입력 거부한다.
- 세션 실패는 401/429/503, CSRF 403, 입력 400, 미지원 메서드 405. DB 변경 및 실제 금융 테스트 데이터 생성 없음.

## 완료 조건

10개 동작의 target/scope/직렬화, 잘못된 메서드/입력/세션/CSRF/상류 응답, 크기·시간 제한, 쿠키/토큰 비노출을 테스트한다. lint/typecheck/전체 일반 테스트/build를 수행하고 새 리뷰어의 경계 검토를 받는다. 브라우저 비로그인 요청의 거부도 확인한다. 이를 PC UI 완료나 운영 보안 감사 완료로 확대하지 않는다.
