# A2.3 요청 제한·만료 정리 — 진행 기록

## 현재 범위

사용자는 문의 메일 예약 완료를 알리고 테스트 API 개발 재개를 요청했다. 실제 발송/수신·금융결제원 답변은 확인하지 않았다. 이번 묶음은 공식 테스트 연결에 필요한 A2.3 DB 기반이다. HTTP API·PC 은행 연결 화면·실계좌 연결은 아직 아니다.

기존 `feature/bank-state-transitions` worktree와 미커밋 인증·거래/A2.2 작업을 보존했다. [설계](../superpowers/specs/2026-10-02-bank-limits-cleanup-design.md), [계획](../superpowers/plans/2026-10-02-bank-limits-cleanup.md), [초급 개발자용 설명](../database/bank-connections.ko.md)을 함께 읽는다.

## 완료·검증 기록

- [x] 실제 DB 기준선271개. 첫 실행은 PostgreSQL 중단/복구 중으로 실패했으며 서버 준비 후 전부 통과했다.
- [x] 요청 제한10개: 함수 부재 RED → GREEN. 최근300초5회/60초60회, 거부 시 연장 금지, key격리, 실제 잠금 경쟁/잠금 뒤 시각 검사.
- [x] 정리9개: 함수 부재 RED → GREEN. 코드만료·버려진 교환·batch·반복안전·정상연결보존·잠긴행생략.
- [x] 카탈로그/권한7개: 신규 TS 선언·index 누락2개 RED → GREEN. API/maintenance/PUBLIC 경계 검증.
- [x] 전체 실제 DB294개(신규23개)·일반1,598개·lint·타입 검사 통과. 타입 검사의 공용 패키지 build도 통과했다. 앱 전체 build/원격 CI는 재실행하지 않았다.
- [x] Playwright CLI, PC1440×900: 로그인 화면·비밀번호 찾기 링크 이동과 공개 폼 표시, 콘솔 오류0/경고0. 제출·실제 로그인·은행 연결 E2E는 이번 smoke에 포함하지 않았다.
- [x] 새 독립 리뷰 Critical0/Important0/Minor1. README 두 곳의 A2.3 후속 표현을 수정해 해소했다. 운영/HTTP/공식 공급자는 리뷰 판단 밖이다.
- [x] Notion10번 카드·A2 상세의 체크/현재 구현/다음 액션을 갱신하고 다시 읽어 검증했다.

전체 DB 검사에서 새 테이블로 인해 기존 정확한 테이블 목록/개수 검사2개가 실패했다. 기존 보안 검사를 줄이지 않고 제한 테이블까지 포함한4개 모두를 검사하도록 수정한 후294개를 재검증했다. TypeScript 검사에서 배열 첫 원소의 부재 가능성1건을 발견해 테스트 assertion에 optional chaining을 적용했다. 이후 타입·해당 DB검사4개·lint를 다시 통과했다. 환경 실패·기능 RED·검증 코드 수정은 서로 구분한다.

## 무엇이 달라졌나

이번 범위는 문서 포함18파일이다. SQL2개, quota TS 선언1개와 export, 요청 deadline index, 신규 DB 시험3개와 기존5개 지원/검사 보완, 설계·계획·결과·설명·문서 지도5개다. 최초 예상보다 기존 카탈로그/보안 검사 보완 파일이 늘었다. 새 의존성·Redis·비밀값 변경은 없다. 조회/정리를 DB 함수로 나누어 API가 직접 테이블을 조작하지 않도록 했다.

`consume_start_limit()`/`consume_callback_limit(digest)`는 한도 결과와 재시도 초를 돌려준다. 후속 API가 각 함수를 먼저 호출하고 commit해야 실제 HTTP 남용 방어가 적용된다. cleanup은 종류별 최대500행이며 자동 스케줄이 아니라 최소 권한 실행 함수만 만든 상태다. 종료된 요청 이력과 연결 토큰은 삭제하지 않는다.

## 아직 남은 일

1. A3 NestJS에서 repository·HTTP principal·세션 검증, HMAC 주소 지문, 429/Retry-After, timeout, 공급자 adapter와 fake/test 구성.
2. A4 BFF 쿠키·CSRF·PC 연결 결과 UI와 Playwright 연결 여정.
3. A5 가상 공급자 통합/보안 회귀, A6 공식 포털 Callback·키·테스트 계좌 등록 확인 후 공식 테스트 호출.
4. 운영 적용 전 maintenance worker/스케줄·모니터링, 실제 Supabase 역할 호환성, 실행 전용 자격과 배포 검증.

이번에는 운영 Supabase에 migration을 적용하거나 금융결제원에 API 요청을 보내지 않았다. 테스트 DB의 합성 봉투는 유효한 은행 토큰을 뜻하지 않는다. 커밋·푸시·새 CI·운영 배포는 실행하지 않는다.
