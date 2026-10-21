# Android 자동 수집 기기 설정 HTTP 계약

## 목적과 범위

이미 구현한 사용자당 1개 수집 세션 DB 경계를 Android 앱이 호출할 수 있게 한다. 실제 알림 접수, APK, OS 권한 화면은 다음 작업이다. PC 화면/수기 기록 권한은 바꾸지 않는다. iOS는 Android 구현·실기기 검증 후 진행한다.

## 요청과 응답

Android bearer 세션 → Next Node BFF `/api/native/collector` → 요청별 서명 JWT → Nest `/v1/collector` → 최소 권한 DB 함수 순서다. JWT의 검증된 sub/sid/chn만 사용한다. 본문에는 사용자·기기·세션 ID를 받지 않는다. Android 채널은 설치 기기 진위 증명이 아니다.

- GET: 쿼리/본문 없음, scope `collector:read`.
- PATCH 활성: `{action:"activate", expectedVersion:0, replaceExisting:false}`. `replaceExisting`는 필수 boolean이며 다른 활성 기기를 교체할 때만 명시적으로 true로 보낸다.
- PATCH 해제: `{action:"deactivate", expectedVersion:1}`. 같은 계정의 다른 활성 기기도 해제할 수 있다. scope `collector:write`.
- 응답: `{version:number,state:"inactive"|"active_here"|"active_elsewhere"}`. 버전은 0~2147483647 정수, 활성 상태는 1 이상. 세션 ID/기기 이름/토큰은 공개하지 않는다.
- 모든 성공/실패는 no-store. GET은 상태 조회일 뿐 이후 자동 저장의 권한 증명이 아니다. 실제 자동 접수는 별도 구현 시 반드시 `runCollector`를 사용한다.

## 오류·동시 요청·보안

입력 오류 400 `COLLECTOR_VALIDATION_FAILED`, 버전 충돌 409 `COLLECTOR_VERSION_CONFLICT`, 다른 기기 교체 미확인 409 `COLLECTOR_REPLACE_REQUIRED`, 세션 무효 401, 웹 채널 403, 기존 읽기/쓰기 rate limit 429. DB 장애·버전 소진은 503 `COLLECTOR_SERVICE_UNAVAILABLE`이다. PATCH는 불확실한 응답을 자동 재전송하지 않고 GET으로 상태를 다시 확인한다. SQL 원문은 공개하지 않는다.

DB 함수가 세션 유효성·사용자 일치·CAS를 다시 확인한다. 같은 기기에서 토큰을 갱신해도 sid가 유지되므로 수집 권한은 유지된다. 로그아웃/새 로그인은 다른 세션이며 재활성화가 필요하다. 동시 교체·해제는 기존 DB 잠금으로 직렬화한다.

## 검증과 완료 기준

공유 계약 경계값, 저장소 오류 은폐, 실제 JWT HTTP 가드, BFF bearer/채널/출력 계약, 실제 최소 권한 PostgreSQL, Next/Nest/DB 연동 Playwright를 검증한다. 두 Android 로그인 간 교체·오래된 버전·다른 사용자 격리·토큰 갱신·로그아웃을 테스트한다. PC 기존 회귀도 실행한다. 운영 DB 적용/배포나 모바일 자동 기록 완료로 표시하지 않는다.
