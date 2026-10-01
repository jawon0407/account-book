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
| 최종 전체 verify/독립 코드 리뷰 |최종 실행 후 아래에 결과를 기록한다 |

합성 IdP와 로컬 폐기용 DB를 사용했으며 실제 사용자 계좌·실제 소셜·운영 DB 검증이 아니다. Playwright 테스트 서버/DB는 실행기가 종료·정리한다. 생성된 screenshot과 로그는 Git에 포함하지 않는다.

## RED → GREEN과 발견 사항

거래 query/cursor/HTTP/DB 모듈 없음, POST404, PC 페이지 없음으로 실패를 확인한 뒤 구현했다. 실제 DB에서 DATE 변환 별칭과 ORDER BY의 모호성을 발견해 테이블 별칭을 명시했다. 커서 오류가 Promise 밖으로 동기 throw되는 문제는 저장소의 async 계약으로 맞췄다. DB 저장소가 HTTP 전용 Fastify 타입을 끌어오는 타입 오류는 순수 `core/validation.ts` 분리로 해결했다.

Playwright pagination 테스트는 빈 query URL도 작은 페이지 요청으로 바꾸도록 테스트 라우팅 패턴을 보완했다. 이는 서버에서 실제 데이터를 읽는 테스트이며 성공 응답을 가짜로 바꾼 것이 아니다.

## 설계 판단

1. 실제 테이블 이름 `finance.transaction_categories`를 사용한다. 이전 설명의 `finance.categories`는 오기다.
2. 커서 결속은 사용자+조회 집합, 페이지 크기는 제외한다. 크기가 달라도 같은 집합을 읽기 때문이다.
3. 기존 멱등 작업 union에 DB가 이미 허용하는 `create_transaction`을 추가했다.
4. 무한 조회의 커서는 TanStack `pageParams`에 저장한다. Query 키는 사용자+필터로 분리해 페이지를 같은 목록에 묶는다.
5. 승인된 PC 디자인을 재사용했다. 기존 모바일 제목 1.75rem은 기존 반응형 예외이며 새로 디자인 체계를 바꾸지 않았다.

이 판단이 바뀌어도 응답/캐시 정책이나 문서 조정 범위이며 새 DB migration은 필요하지 않다.

## 아직 개발/검증하지 않은 것

일반 거래 수정·soft delete, 시작 잔액·원자적 이체, 은행 연결/조회/수집, 별도 모바일 앱, 운영 배포·실제 공급자 로그인. DB에 존재하는 이체/시작 잔액 행의 읽기·표시는 가능하지만 생성 버튼/API를 구현한 것은 아니다. 거래 메모 수정/분류 변경도 수정 API 단계에서 진행한다.

다음 순서: 일반 거래 수정/삭제 + expectedVersion → 시작 잔액/이체 → 은행 조회/수집 → 모바일. 현재 단계가 완료돼도 Notion 13번 카드의 상세 수정·자동수집 분류까지 전부 완료로 표시하지 않는다.
