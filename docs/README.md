# 프로젝트 문서 지도 — 먼저 읽어 주세요

갱신 기준: 2026-09-29, main `b7ecd83` / 후속 `feature/bank-state-transitions`. 저장소 PUBLIC·main 보호를 적용했고 CI 보완 PR #14/#17, 은행 보안 기반 PR #13, 은행 DB 구조·권한(A2.1) PR #18은 정상 병합·main 검사까지 완료했습니다. 다음 A2.2 상태 처리의 사전 범위를 정리했으며 상세 설계·구현은 아직 후속입니다. 이 문서는 **실제 구현**, **승인된 목표**, **검증하지 못한 운영 설정**을 구분합니다. 사용자는 1~2절부터, 초급 개발자는 3절의 순서대로 읽으면 됩니다.

현재 작업은 [은행 DB 완료 기록](status/2026-09-28-bank-storage.ko.md) → [초급 개발자용 저장 흐름](database/bank-connections.ko.md) → [다음 상태 처리 사전 점검](status/2026-09-29-bank-state-transitions-next.ko.md) 순서로 읽습니다. [파일별 실행 계획](superpowers/plans/2026-09-28-bank-storage.md), [앞선 보호·CI 실행 결과](status/2026-09-28-public-protection-execution.ko.md), [전체 진행 지도](status/2026-09-24-project-map.ko.md)와 [Notion 기능별 현황](https://app.notion.com/p/817d15a21e174eac86a7d3608a21b457)에서 구현·미완료를 확인합니다. 일반 작업은 반복 승인 없이 진행하되 규모·파일·검증 기록을 남깁니다.

외부 코드의 적용 경로·출처·원문은 [라이선스 고지](../THIRD_PARTY_NOTICES.md), 이번 보완의 범위·검증은 [고지 보완 계획](superpowers/plans/2026-09-28-third-party-license-notices.md)에서 확인합니다. 로컬 반영과 원격 공개·보호 적용은 별개입니다.

## 1. 지금 무엇을 사용할 수 있나요?

| 분야 | 이미 있는 코드 | 아직 없는 것 |
| --- | --- | --- |
| 웹 | 로그인·가입·이메일 확인·비밀번호 복구 화면 5개, 인증 BFF route 14개 | 메인 `/`, 로그인 후 `/app` 장부 화면, 거래 입력·대시보드 |
| 백엔드 | `/health`, 보호된 `/v1/me`, 요청 결속 JWT·재사용 방어 | 실제 금융 CRUD·집계·멱등 저장 API |
| 데이터베이스 | main: 인증6개 + JWT replay1개 + 은행 연결3테이블·조회 RLS, 실제 DB 112개 검사 통과 | 은행 연결 상태 변경 함수, 계좌·카테고리·거래·이체 원장 |
| 공용 계약 | 계좌·분류·거래·이체의 Zod 입력/응답 검증, UUID 정규화 | 계약을 실제 DB 저장과 화면에 연결하는 작업 |
| 모바일 | 웹과 같은 계정·API·DB를 쓰는 설계 | `apps/mobile`, Expo/React Native 코드·배포 |
| 운영 | 로컬 검사·disposable CI 기반 | 실제 OAuth 공급자, 플랫폼 권한·풀러·백업·복구·경보 검증 |

로그인 화면이 있다는 것과 가계부가 완성됐다는 것은 다릅니다. 현재 실제 금융정보를 저장하는 베타는 **시작할 수 없는 상태**입니다. 인증 테스트가 redirect URL만 확인했다고 최종 장부 화면까지 존재하는 것은 아닙니다.

## 2. 최종 제품은 어떻게 연결되나요?

PC는 Next.js 웹, 모바일은 별도 React Native + Expo 앱입니다. **PWA가 아닙니다.** 두 기기에 DB를 하나씩 두는 대신, 인증한 사용자가 하나의 서버 원장을 공유합니다.

```text
PC 브라우저 → Next.js BFF → Node API → PostgreSQL
별도 모바일 앱 ───────────→ Node API → 같은 PostgreSQL (구현 예정)
```

BFF는 웹 브라우저를 대신해 세션과 서버 간 요청을 처리하는 서버입니다. 브라우저·앱에 DB 비밀번호를 넣지 않습니다. 현재 BFF의 DB 연결은 인증 저장소용이고 API의 DB 연결은 JWT replay 방어용입니다. 금융 원장은 다음 구현 대상입니다.

## 3. 분야별 문서와 추천 읽기 순서

작업을 시작하기 전에는 [작업 사전 계획·승인·검증·기록 절차](guides/change-workflow.ko.md)를 따른다. [2026-09-09 Next 보안 업데이트 계획](superpowers/plans/2026-09-09-next-security-update.md)은 사용자 승인 후 Next 16.3.3·baseline-browser-mapping 2.11.0으로 적용했다. 로컬 `pnpm verify` 873개 테스트·타입·lint·API/웹 빌드 및 운영 audit 0건을 확인했다. 커밋·푸시·새 CI·배포는 미실행이며, 실제 DB/E2E와 `preferredRegion` 사용 중단 경고의 배포 정책 검토는 남아 있다. 9월 8일 결과와 이번 실행 증거를 구분한다.

| 순서·분야 | 문서 | 읽으면 알 수 있는 것 |
| --- | --- | --- |
| 1. 기획 | [제품 원칙](../PRODUCT.md), [로드맵](roadmap/README.md) | 사용자 목표, 포함/제외 범위, M1~M5 남은 작업 |
| 2. 입문 | [코드 읽기 가이드](guides/code-reading.ko.md) | 함수·매개변수·타입, 실제 요청 흐름, DB 용어 |
| 3. 프론트 | [프론트 구조](architecture/frontend.ko.md), [웹 README](../apps/web/README.md) | 화면→hook→ky, 로딩·오류와 메모리 상태 |
| 4. 디자인 | [디자인 시스템](../DESIGN.md) | 중립 오프화이트, 얕은 뉴모피즘, 실제 색상·너비 규칙 |
| 5. 백엔드 | [인증 아키텍처](architecture/backend-authentication.ko.md), [API README](../apps/api/README.md) | BFF·서비스·저장소·API guard의 역할과 보안 경계 |
| 6. DB | [인증 스키마](database/auth-schema.ko.md), [DB 패키지](../packages/database/README.md) | 현재 테이블·권한·마이그레이션과 연결 수명 |
| 7. 개발 로직 | [풀스택 개발 흐름](guides/full-stack-development-flow.ko.md), [공용 계약](../packages/contracts/README.md) | 실제 경계와 후속 금융 구현 절차, 멱등성·version |
| 8. 보안·운영 | [보안 모델](security/security-architecture.md), [운영 가이드](guides/backend-auth-operations.ko.md), [온보딩](guides/platform-and-oauth-onboarding.ko.md) | 코드로 보장하는 것과 사용자·운영 환경에서 확인할 것 |
| 9. 증거 | [진행 기록](status/2026-08-24-development-progress.ko.md), [보안 체크리스트](security/verification-checklist.md) | 날짜·SHA별 테스트 결과와 미완료 출시 조건 |

## 4. 어떤 설계가 최신인가요?

1. 제품 플랫폼: [2026-07-27 웹·네이티브 공유 장부 설계](superpowers/specs/2026-07-27-web-native-mobile-shared-ledger-design.md).
2. 인증 저장 방식: [opaque session ADR](architecture/adr/0001-opaque-auth-sessions.md).
3. 인증 디자인: [2026-08-25 접근성 우선 뉴모피즘](superpowers/specs/2026-08-25-accessible-neumorphism-auth-design.md).
4. 금융 입력/응답: [2026-08-26 공개 계약 설계](superpowers/specs/2026-08-26-ledger-public-contracts-design.md) + 실제 `packages/contracts/src`.
5. 저장소 보호: [무료·공개 기본 보호 설계](superpowers/specs/2026-09-24-public-repository-branch-protection-design.md) + [실제 적용·검증](status/2026-09-28-public-protection-execution.ko.md). 실금융 운영 보안 검증과는 구분합니다.
6. 은행 연결 DB: [A2.1 저장 구조·권한 설계](superpowers/specs/2026-09-28-bank-storage-design.md). A2.2 상태 처리·A2.3 요청 제한은 후속입니다.

`superpowers/specs`·`plans`의 오래된 문서는 당시 결정과 테스트 기록을 보존합니다. 초기 PWA·오프라인 큐 설명을 현재 기능으로 읽지 마세요. 충돌하면 최신 승인 결정과 실제 코드를 대조하고, 보안 중단 조건은 [SECURITY.md](../SECURITY.md)를 따릅니다. 계획서의 체크박스만으로 구현 여부를 단정하지 않습니다.

## 5. 현재 검증 증거를 읽는 법

- [2026-09-28 공개 전 노출 감사](security/2026-09-28-public-exposure-audit.ko.md): Git 이력·PR·댓글·실행 로그의 실제 검사 범위와 공개 보류 조건. 라이선스 고지·작성자 개인정보·원격 보호는 별도 확인이 필요합니다.

- HEAD `5cc94601c74a1e08f848a0cbc0bde191e7a47f81`의 CI 성공 기록은 899개 검사 대상 테스트입니다. preflight를 중복 합산하지 않습니다.
- 이후 UUID 수정과 문서·주석 변경은 2026-09-08 커밋 전 `pnpm verify`로 872개 테스트, lint, 6개 workspace 타입 검사, API·웹 빌드를 통과했습니다. contracts 66개가 이 합계에 포함됩니다. 운영 의존성 audit도 알려진 취약점 0건입니다. 원격 CI 결과와는 구분합니다.
- 이번 문서·주석 작업은 동작 변경 없이 설명을 추가합니다. 추가 침투 테스트와 실제 기기 테스트는 사용자 요청대로 보류합니다.
- 의존성 audit 0건은 알려진 패키지 취약점 결과일 뿐 보안 문제 전체가 없다는 뜻이 아닙니다. Impeccable live 개발 도구 문제는 미해결이며 실행을 보류합니다.
- 서버에 운영 secret을 넣거나 실제 금융 데이터를 입력하지 않고도 코드 학습과 로컬 개발을 할 수 있습니다. 실제 secret은 문서·주석·채팅에 적지 않습니다.
