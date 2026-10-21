# Android 이메일 인증 HTTP 계약

Android 우선 구현. 기존 세션 채널·자격 증명 교체 위에 실제 앱 접속 경로를 연결한다. 웹 인증·장부 API를 대체하지 않으며 iOS는 후속이다.

## 엔드포인트

| 경로 | 메서드 | 입력 | 성공 |
| --- | --- | --- | --- |
| `/api/native/auth/sign-in` | POST | 이메일·비밀번호·설치 UUID | 앱 sessionToken + session |
| `/api/native/auth/session` | GET | Authorization Bearer 앱 자격 증명 | session |
| `/api/native/auth/session/refresh` | POST | Bearer + 빈 JSON 객체 | 교체한 sessionToken + session |
| `/api/native/auth/sign-out` | POST | Bearer + 빈 JSON 객체 | signedOut: true |

session은 authenticated:true, userId, deviceId, refreshAt만 포함한다. refreshAt은 제공자 토큰 만료 60초 전이며 앱의 절대 로그인 수명과 다르다. 제공자 토큰·DB 식별자 해시·역할·외부 응답은 반환하지 않는다. 모든 응답은 no-store이며 쿠키를 만들지 않는다.

## 신뢰 경계

- Node.js 라우트의 고정 operation으로 호출한다. canonical HTTPS origin·정확한 경로·쿼리/fragment 없음·고정 메서드를 검사한다.
- 로컬 NextURL의 127.0.0.1/IPv6 loopback → localhost 정규화만 예외 처리한다. 설정 주소가 loopback이고 HTTPS·포트가 같으며 원래 Host가 설정과 정확히 일치해야 한다. 공인 주소나 X-Forwarded 헤더로 범위를 넓히지 않는다.
- Cookie, Origin, Sec-Fetch 계열 헤더를 받지 않으며 CORS를 허용하지 않는다. 이 검사는 브라우저와의 혼용 방지이지 정식 앱/Android 하드웨어 증명이 아니다.
- 로그인에는 Authorization을 받지 않는다. 나머지는 canonical 32바이트 불투명 Bearer 하나만 받는다. 채널은 서버 서비스 구성에서 android로 고정한다.
- POST는 UTF-8 application/json, 최대 16KiB, 전체 읽기 3초, strict schema. GET 본문은 금지한다.
- 이메일 인증된 사용자·토큰 소유자·시각을 기존 검증 함수로 확인한 뒤 앱 세션을 생성한다. 설치 UUID는 수집 권한이나 인증 수단이 아니다.
- 갱신은 이전 단위의 원자적 교체를 사용한다. 앱은 갱신/로그아웃을 직렬화한다. 저장 후 응답 유실은 재로그인하며 자동 POST 재전송을 지시하지 않는다.
- 로그아웃은 현재 값의 로컬 폐기 성공 뒤 제공자의 현재 세션만 `scope: local`로 종료한다. PC·다른 기기의 로그인은 유지한다. 제공자 실패는 보류 기록을 남긴다. 이전 값의 폐기 false를 성공으로 표시하지 않는다.

## 요청 제한

기존 BFF 전용 auth_rate_limits에 native_auth 종류만 추가한다. 서버가 정한 operation/scope와 HMAC 지문을 사용하며 이메일·자격 증명 원문을 저장하지 않는다. DB 시각으로 고정 창을 계산하고 INSERT ON CONFLICT로 제한을 공유한다.

- 전역 분당: 로그인 120, 세션 조회 1,200, 갱신/로그아웃 각각 600. 전역 통과 후에만 개별 지문을 생성한다.
- 로그인: 정규화 이메일 10분 6회, 설치 ID 10분 30회.
- 인증 후 사용자+설치: 조회 분당 60, 갱신 분당 10, 로그아웃 분당 10.
- 상한 도달 시 429, DB 실패는 503으로 거절한다. 임의 X-Forwarded-For를 신뢰하지 않는다.
- native_auth의 20분 이전 행을 요청마다 최대 500개 정리한다. 활동이 없으면 다음 요청까지 남을 수 있어 정확한 삭제 기한 보장은 아니다. 다른 종류의 제한 기록은 삭제하지 않는다.
- 전역 상한은 베타 보호책이며 분산 서비스 거부 방어 전체를 대체하지 않는다. 출시 전 플랫폼 제한·경보·실측 조정은 남는다.

## 검증과 범위

공용 스키마·HTTP 헤더/본문·공급자 실패·저장소 실패·세션 교차 사용·새 값 교체·이전 값 재사용·요청 제한을 TDD로 검증한다. 실제 임시 DB에서 BFF 역할·경쟁 제한·기존 종류 호환·정리를 확인한다. 실제 로컬 Next HTTP 경로와 PC Playwright 회귀를 검증한다. 실계정/실금융 알림을 fixture로 쓰지 않는다.

모바일 가입·복구/소셜 복귀, NestJS 모바일 위임·기기 1대, 앱 안전 저장소·화면·알림 수집은 남은 작업이다. 처음에는 기존 검증된 이메일 계정으로 로그인 연결부터 검증한다. 실제 DB 이관과 배포는 이번 작업에서 하지 않는다.
