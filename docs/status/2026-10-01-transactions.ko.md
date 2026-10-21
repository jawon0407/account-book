# 2026-10-01 소셜 준비 푸시·거래 조회/입력 진행

## 먼저 완료한 전송

요청에 따라 기존 소셜 앱 준비·core DB/API/BFF/PC 변경 187파일을 `e6890b60c80072693f8be0126214b340fa30d37f`로 커밋하고 `feature/bank-state-transitions`에 푸시했다. 원격 SHA 일치를 확인했다. 커밋 전 `pnpm verify` 통과, Git 변경 blob647개 보안 게이트 통과. 실제 `.env`, 인증서, 개인 설정, 테스트 출력은 포함하지 않았다. Google/Kakao/Naver 콘솔 활성화·secret 입력 및 실제 공급자 로그인은 사용자 작업/후속 검증이다.

## 이어서 구현한 범위

- Nest `GET/POST /v1/transactions`: 본인 거래 조회·필터·keyset 페이지·수입/지출 생성.
- 같은 출처 BFF `GET/POST /api/transactions`: 고정 scope와 query 결속, 세션·CSRF·응답 계약.
- PC `/app/transactions`: 거래 목록, 계좌/분류/종류/날짜 필터, 더 보기, 수입/지출/메모 입력.
- 응답 유실 시 기존 본문/멱등 키 고정, 명시적 재시도. 성공 후 거래·계좌 잔액 재조회.
- 계정 재확인 중 이전 거래/입력 숨김, 계정 불일치 거부, 영구 금융 저장 없음.
- 함수·매개변수 주석과 [한국어 개발 설명](../guides/transaction-development.ko.md).

신규 API는 기존 최소 권한 DB·스키마를 재사용한다. 원격 DB 변경, 새 migration, provider secret 입력, 배포·결제는 하지 않았다. 커서/HTTP/mapping/저장소와 PC 전송/query/필터/표/폼을 역할별 파일로 분리했다.

## 확인한 테스트

| 검사 | 당일 확인 결과 |
| --- | --- |
| API 집중/전체 |236개 통과 |
| 실제 폐기용 PostgreSQL |215개 통과(거래 저장소6개 포함) |
| BFF·거래 브라우저 집중 |156개 통과 |
| 전체 workspace typecheck |통과 |
| 실제 Playwright core |5개 통과, 실제 저장 후 응답 유실/동일키 재시도·필터·페이지·잔액·보관 경쟁·계정 전환 포함 |
| 화면 |1920/1440/1080/390px 가로 넘침 없음; 거래 목록 axe 위반0; 1440px screenshot 시각 확인 |
| 디자인 |독립 소스 검토+기계 검사; type/layout 결정 규칙 위반0. 필터 입력 굵기와 좁은 화면 여백 통일 |
| 최종 전체 verify |보완 후 통과: lint·typecheck·일반 1,499개·웹/API production build |
| 독립 코드 리뷰 |Critical0/Important1/Minor0; 재시도 키 초기화 결함을 RED2→GREEN5로 수정, 전체 verify·실제 Playwright 5개 재통과. 미해결 중요/경미 지적 없음 |

합성 IdP와 로컬 폐기용 DB를 사용했으며 실제 사용자 계좌·실제 소셜·운영 DB 검증이 아니다. Playwright 테스트 서버/DB는 실행기가 종료·정리한다. 생성된 screenshot과 로그는 Git에 포함하지 않는다.

최종 일반 1,499 = legacy207 + contracts89 + DB schema19 + API236 + web862 + E2E preflight86. 보완 전 web860에서 회귀 테스트2개가 늘었다. 실제 DB215와 브라우저5개는 별도다. 최종 helper를 Git Bash에서 직접 실행할 때 Windows Git 경로 자동 탐지가 달라져 hook fixture 1개가 시작하지 못했다. 애플리케이션 코드를 변경하거나 검사를 생략하지 않고 표준 Windows Git 경로로 실행한 PowerShell에서 전체 verify를 다시 통과했다.

거래 구현 커밋은 `d38922d26e337f0e4c47316a8bc1eb916d4eee4f`다. 실제 변경량은 38파일·892줄 추가/30줄 삭제(테스트·문서 포함)다. 새 migration·패키지 설치는 없으며 기능별 작은 파일로 분리했다. 최종 검증/리뷰 기록은 후속 문서 커밋으로 남긴다.

## RED → GREEN과 발견 사항

거래 query/cursor/HTTP/DB 모듈 없음, POST404, PC 페이지 없음으로 실패를 확인한 뒤 구현했다. 실제 DB에서 DATE 변환 별칭과 ORDER BY의 모호성을 발견해 테이블 별칭을 명시했다. 커서 오류가 Promise 밖으로 동기 throw되는 문제는 저장소의 async 계약으로 맞췄다. DB 저장소가 HTTP 전용 Fastify 타입을 끌어오는 타입 오류는 순수 `core/validation.ts` 분리로 해결했다.

Playwright pagination 테스트는 빈 query URL도 작은 페이지 요청으로 바꾸도록 테스트 라우팅 패턴을 보완했다. 이는 서버에서 실제 데이터를 읽는 테스트이며 성공 응답을 가짜로 바꾼 것이 아니다.

최종 독립 리뷰에서 `최초 저장 응답 유실 → 다음 재시도의 요청 제한/CSRF 거부`가 원래 미확정 키를 버릴 수 있음을 발견했다. 두 공개 오류를 각각 재현해 폼 잠금이 풀리는 RED를 확인했다. 한 번 미확정인 요청은 후속 거부로 미저장이라 단정하지 않고, 같은 입력·키를 유지하도록 수정했다. 최초 요청부터 확정 거부인 경우는 계속 수정 가능하다. Playwright도 첫 요청 실제 저장/응답 유실 → 두 번째 429 대역 → 세 번째 실제 동일키 재시도로 확장했다. 429는 장애 재현 대역이고 서버의 실제 rate-limit 정책을 검증한 결과는 아니다.

## 설계 판단

1. 실제 테이블 이름 `finance.transaction_categories`를 사용한다. 이전 설명의 `finance.categories`는 오기다.
2. 커서 결속은 사용자+조회 집합, 페이지 크기는 제외한다. 크기가 달라도 같은 집합을 읽기 때문이다.
3. 기존 멱등 작업 union에 DB가 이미 허용하는 `create_transaction`을 추가했다.
4. 무한 조회의 커서는 TanStack `pageParams`에 저장한다. Query 키는 사용자+필터로 분리해 페이지를 같은 목록에 묶는다.
5. 승인된 PC 디자인을 재사용했다. 기존 모바일 제목 1.75rem은 기존 반응형 예외이며 새로 디자인 체계를 바꾸지 않았다.
6. 일반 거래 수정/삭제·시작 잔액/이체 생성은 후속으로 유지한다. 잘못된 판단이라면 사용자는 해당 API/화면 개발까지 기다려야 한다.
7. 닫기/새로고침 후 미확정 요청의 영구 복원은 추가하지 않는다. 금융 캐시를 영구 저장하지 않으므로 목록 확인으로 안내한다. 그 대가는 미확정 폼을 닫은 뒤 사용자가 거래를 확인해야 한다는 점이다.
8. 목록은 고정 snapshot이 아닌 실시간 keyset 조회다. 동시 변경의 최신 집합은 새로고침으로 확인한다. 동시 수정 중에는 재조회가 필요할 수 있다.
9. 실제 소셜·운영·은행 연결은 완료로 판정하지 않는다. 외부 설정/동의 이후 검증해야 하며, 미완료 시 출시를 기다려야 한다.

1~5번의 판단은 현재 스키마를 유지하는 문서·응답·캐시·화면 범위다. 6~9번은 구현/검증 범위 구분이며, 후속 기능에서 DB 변경이 필요하면 별도 migration 검토를 거친다.

## 푸시 후 공급망 경고 — 우선 패치

거래 구현·보완은 `3936b469c60ab56dccdb4d9d273c797f6e48d3ad`로 원격 SHA 일치까지 확인했다. 전송 보안 게이트는 620blob 통과했으나, 이 검사가 의존성 취약점의 부재까지 뜻하지 않는다. GitHub Dependabot #32에서 기본 브랜치와 현재 브랜치의 `fast-uri 4.1.4`가 영향 범위에 포함됨을 확인했다.

[공식 GHSA-jvvf-x445-j334](https://github.com/fastify/fast-uri/security/advisories/GHSA-jvvf-x445-j334)는 인코딩된 mailto 필드명이 parse/serialize 사이에 달라지는 중간 등급 취약점이다. 영향 범위는 `>=4.1.3, <4.1.5`, 패치 버전은 `4.1.5`다. 앱 소스에서 직접 fast-uri/mailto 처리 경로는 찾지 못했지만, 전이 의존성의 안전함을 단정하지 않는다.

보안 우선으로 `pnpm-workspace.yaml`의 기존 override, `pnpm-lock.yaml`, `scripts/workspace-policy.test.mjs`와 이 기록을 변경한다. 먼저 4.1.5만 허용하고 4.1.4 회귀를 거부하는 검사로 RED를 확인한 뒤 공식 패치를 설치하고 전체 verify/PC Playwright를 재검증한다. 새 기능·원격 DB·배포·secret 변경은 없다.

추가 `pnpm audit --prod`에서 Critical1/High1/Moderate2를 발견해 API/Web manifest까지 같은 메이저 보안 갱신으로 넓혔다. 실제 앱에서 취약점이 악용됨을 확인한 것이 아니라, 설치 버전이 공개 영향 범위에 포함된다는 뜻이다. 공급자 secret·DB 권한·인증 정책은 바꾸지 않는다.

| 패키지 | 이전 → 적용 대상 | 공식 근거 |
| --- | --- | --- |
| Next.js |16.3.3 → 16.3.6 |[Node ImageResponse의 RCE](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j) |
| Nest common/core/platform-fastify/testing |11.1.28 → 11.2.5 |[absolute-form 경로의 middleware 우회](https://github.com/advisories/GHSA-9c5c-9qcx-q35q); 공식 권장11.2.5에 계열 버전 정렬 |
| Fastify |5.12.3 → 5.12.5 |[HTTP/2 trailer 예외 DoS](https://github.com/advisories/GHSA-4mh8-r7rc-xpvc) |
| fast-uri 3.x |3.1.7 → 3.1.8 |[인코딩된 호스트 대소문자 정규화](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj) |
| fast-uri 4.x |4.1.4 → 4.1.5 |[mailto 필드명 처리](https://github.com/fastify/fast-uri/security/advisories/GHSA-jvvf-x445-j334) |

기존 unused sharp 제외·PostCSS/브라우저 매핑 고정과 strict peer/engine 검사를 유지한다. 설치 lifecycle script는 실행하지 않았다. 이전 취약 해석이 재유입되면 실패하도록 정책 검사를 RED3으로 확인한 후 manifest/override를 변경했다. 첫 fast-uri 단독 갱신 후 검증은 Windows `.next` 생성 파일의 EPERM 잠금으로 build에서 중단됐으며 성공으로 세지 않는다. 새 갱신 후 산출물을 분리하고 전체 검사를 다시 실행한다.

갱신 후 `pnpm audit --prod`: info/low/moderate/high/critical 모두0. 정책검사4개와 전체 `pnpm verify` 1,499개·lint·타입 검사·Next16.3.6/Nest11.2.5 build가 통과했다. 이는 해당 시점 운영 의존성의 공개 경고 결과이며 dev 의존성 감사나 전체 침투테스트를 대신하지 않는다. GitHub 기본 브랜치의 경고는 기능 브랜치 패치만 푸시한다고 즉시 닫히지 않으며 main 병합을 임의 진행하지 않는다.

패치 후 실제 PC Playwright5개도 27.8초로 통과했다. 계좌/분류/프로필 관리, 거래 저장·응답 유실/429 이후 동일키 재시도, 페이지·잔액 반영, 계정 재확인 시 숨김을 같은 새 의존성 환경에서 재검증했다.

폐기용 PostgreSQL 전체215개도 패치 후 다시 통과했다. 보안 후속의 실제 변경은6파일·172줄 추가/130줄 삭제(주로 자동 잠금파일과 검증/문서)이며, 검사 산출물·실제 env·인증서는 커밋하지 않는다.

## 남은 제품 기능

일반 거래 수정·soft delete, 시작 잔액·원자적 이체, 은행 연결/조회/수집, 별도 모바일 앱, 운영 배포·실제 공급자 로그인. DB에 존재하는 이체/시작 잔액 행의 읽기·표시는 가능하지만 생성 버튼/API를 구현한 것은 아니다. 거래 메모 수정/분류 변경도 수정 API 단계에서 진행한다.

다음 순서: 일반 거래 수정/삭제 + expectedVersion → 시작 잔액/이체 → 은행 조회/수집 → 모바일. 현재 단계가 완료돼도 Notion 13번 카드의 상세 수정·자동수집 분류까지 전부 완료로 표시하지 않는다.
