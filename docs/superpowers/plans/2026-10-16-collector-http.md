# Android 수집 설정 API 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 같은 세션 TDD와 최종 독립 리뷰 1회.

**Goal:** 승인된 계정당 자동 수집 1대 정책을 기존 Android 인증 경로에 연결한다.
**Architecture:** 공유 Zod 계약 → 고정 BFF 작업 → Nest guard/controller/repository → 기존 collector DB 함수.
**Spec:** [HTTP 설계](../specs/2026-10-16-collector-http-design.md).

## 제약·자체 점검

혼합 미커밋 변경 보존, 원격 DB/배포/커밋/푸시 없음. 자동 알림 접수·APK는 별도다. routine 승인 생략 지시에 따라 기존 정책을 구체화한다. Autoplan 참조 파일 누락은 직접 설계/TDD/독립 리뷰로 보완하며 전체 파이프라인 실행으로 주장하지 않는다. CSO는 인증/최소 권한/정보 노출, QA-only는 실제 브라우저 회귀, review는 변경 단위 코드 검토에 적용한다.

Task1의 계약 이름/오류/응답을 Task2가 그대로 사용한다. 새로운 테이블·migration은 필요 없다. 테스트 환경에 기존 collector migration만 추가한다. 약 20~25개 파일의 중간 규모이며 성능 목표를 테스트 개발 서버 시간으로 판단하지 않는다.

### Task 1: 공유 계약·Nest 설정 API

**Files:** 새 `packages/contracts/src/collector.ts`, `.test.ts`; index/errors/internal-api 확장; 새 `apps/api/src/collector/collector.controller.ts`, `collector.repository.ts`, repository test; core.module/core-http.test 확장; 새 `tests/database/collector-repository.test.ts`.

- [x] 계약/저장소/HTTP 테스트 RED 확인: 미구현 모듈 3 suite 실패.
- [x] strict input/output, Android-only 두 scope, 검증된 principal sid 사용 구현.
- [x] 실제 최소 권한 DB 조회·교체·CAS·다른 사용자 거절 검사 2개 통과.
- [x] 계약26·API50개 통과 후 ledger 기록. row 배열 each fixture 오류 1건은 테스트 코드만 수정.

### Task 2: BFF·Playwright·보안 검토·현황

**Files:** core operations/controller/http-boundary, 새 native collector route, native routes/controller tests, E2E setup/config 및 새 native-collector.spec; 현황/통합 설계/Notion04/07.

- [x] 고정 경로/채널/오류/응답 계약 14개 RED 확인 후 기존 포함58개 통과.
- [x] 두 Android 세션과 다른 사용자, 교체/갱신/로그아웃 실제 HTTP Playwright. 전체18개/44.1초 통과.
- [x] verify1,961·DB355·core Playwright18·운영/전체 audit0·diff 검사. 최초 lint 실패는 수정 후 전체 재실행.
- [x] 독립 리뷰1회 Critical0/Important0/Minor1. 공통 오류 코드 문서 일관성 후속 기록. 코드 수정 pass 없음.
- [x] 구현/미구현 구분해 MD·Notion04/07 갱신·재조회. async 성공 확인, 새 섹션/검증 수치 확인. 원격 PR22는 open/기존 head이며 로컬 수정 미포함.

최종 결과: [초급 개발자용 흐름과 검증/보류 보고](../../status/2026-10-16-collector-http.ko.md). 변경은 미커밋으로 남기며 실행 ledger를 보존한다. 실제 Android 앱/알림 접수는 후속이다.
