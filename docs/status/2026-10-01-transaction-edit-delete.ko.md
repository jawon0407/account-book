# 2026-10-01 일반 거래 수정·삭제

상태: 구현·전체 테스트·PC 검증·최종 빌드·독립 리뷰 완료. feature/bank-state-transitions, 기준 HEAD 4f080327. 기존 인증 변경과 함께 미커밋 상태이며 원격 반영/운영 배포는 하지 않았다.

## 범위와 파일

- Nest: transactions.repository/controller + transaction-changes.ts. 사용자 RLS·행 잠금·기대 버전·보관 참조·soft delete.
- BFF: operations.ts, transactions/[id]/route.ts, 금융 request-origin.ts의 DELETE 허용. 기존 인증 POST 제한 유지.
- PC: api.ts, transaction-page/table, edit/delete form, use-transaction-change.ts. 기존 CSS/기본 dialog 재사용.
- 테스트: 실제 DB, 서명 HTTP, BFF/Next route, ky/폼, Playwright 실제 여정.
- 문서: 실행 계획·이 문서·초급 개발 흐름·Notion 기능13. 새 패키지/스키마/migration 없음.

## 실행 증거

- 기준 API236개 통과 후 시작.
- 폐기용 PostgreSQL 신규5개 RED(미구현) → 기존 포함11개 GREEN.
- Nest PATCH/DELETE RED2 → 해당 HTTP34개 GREEN.
- BFF/ky RED3, DELETE의 공통 CSRF 제한 RED1 → 경계208개 GREEN.
- UI 빈 컴포넌트의 동작5개 RED → 구현 후5개 GREEN.
- 타입 검사에서 DB helper의 과도한 PoolClient 요구를 발견하여 기존 DbClient(query만) 계약으로 수정. 이후6개 workspace 타입 검사·lint 통과.
- 첫 실제 Chromium 실행: 정상 수정·충돌·삭제·잔액은 통과. 세션 만료의 화면 잠금 연결을 발견하여 Query mutation 경계로 보완하고 최종 재검증을 통과했다.
- 최종 `pnpm test`: **1,598/1,598** (legacy207 + contracts89 + DB schema19 + API238 + web959 + preflight86).
- 최종 `pnpm test:db`: 폐기용 PostgreSQL **242/242**, 17파일, 20.15초. Playwright와 순차 실행.
- 최종 Playwright core: 실제 Chromium **13/13**, 41.1초. 기존9개 + 수정/삭제4개. 세션 만료2개 RED→GREEN, 실제 저장200/201 이후 응답 유실 확인 포함.
- 편집/삭제 dialog axe 위반0, 1920/1080/390/1440px 문서 가로 넘침 없음, PC screenshot 시각 확인. 별도 Android/iOS 실기기 검사와 구분한다.
- 테스트 도구 `route.fetch`가 sec-fetch-site를 생략하여403이었던 실험은 같은 출처임을 확인 후 테스트 전송에만 metadata를 복원했다. 앱 CSRF 규칙은 완화하지 않았다. 이전 생성 유실 실험도 성공201 확인 후 abort하도록 강화했다.
- 최종 lint·6개 workspace typecheck·Nest/Next production build 통과. 변경 파일 diff 공백 검사 통과.
- 독립 최종 리뷰: Critical/Important/Minor 지적 없음. 리뷰어는 코드와 테스트 내용을 검토했고, 테스트 실제 실행과 screenshot 시각 검사는 주 작업자가 수행했다.

## 결정과 제한

1. 목록에 전체 거래 snapshot이 있어 GET 상세 경로는 추가하지 않았다. 버전이 오래됐으면409 후 최신 목록에서 다시 편집한다.
2. 삭제는 soft delete이며 복구 UI는 제공하지 않는다. 재삭제/타인/없는 거래 모두404다.
3. 생성 멱등 재시도는 유지하지만 수정/삭제 응답 유실은 폼을 잠그고 재조회한다. 성공으로 추측하지 않는다.
4. 실제 은행 연결·시작 잔액/이체·별도 모바일 앱은 후속이다. 실제 개발 Supabase 금융 행과 운영 migration은 건드리지 않았다.
5. Impeccable 기준으로 기존 청록 버튼·흰 폼·native dialog·44px 조작 크기를 재사용했다. Ponytail 기준으로 새 상세 조회 API/라이브러리/잔액 저장 필드는 만들지 않았다.

## 리뷰 범위에 대한 판단

- 앞선 인증 수정은 별도 작업이라 독립 리뷰를 반복하지 않았지만 이번 전체 회귀 검사에는 포함했다. 실공급자·실메일 문제까지 보장하는 것은 아니다.
- 운영 배포/실제 금융 데이터는 검사하지 않았다. 운영 전 별도 권한·연결·백업 검증을 생략하면 실제 서비스 장애/정보 노출 위험이 남는다.
- 은행 연결·이체/시작 잔액·복구 UI·네이티브 모바일은 명시된 후속이다. 따라서 현재 기능을 완성된 은행 연동 앱으로 안내하지 않는다.
- 리뷰어가 직접 확인하지 않은 렌더링은 주 작업자가 실제 Playwright screenshot과 axe로 확인했다. Android/iOS 실기기나 모든 화면 크기 검증을 대신하지 않는다.
- 금융 DELETE만 CSRF 허용 메서드에 추가했다. 잘못된 확장을 막기 위해 인증 DELETE 거부·다른 출처·다른 세션·누락 토큰 검사를 유지했다.
- 테스트 대역의 보안 헤더 복원은 실제 브라우저 헤더 생성 검사가 아니다. 대역 없는 정상 저장·삭제 여정을 병행해 해당 한계를 보완했다.

사용자는 앞선 인증 문제 해결을 직접 확인했다. 이는 모든 공급자의 실제 소셜 로그인·메일 전달 검증 완료를 뜻하지 않는다.

## 로컬 실행과 인계

새 빌드로 API와 웹을 재시작했다. `https://localhost:3000/login`은200, `http://127.0.0.1:3001/health`는200이다. 새 BFF PATCH/DELETE와 API PATCH의 비인증 요청은401이며 실제 금융 행에 접근하지 않았다. Playwright MCP에서 로컬 로그인 화면도 직접 확인했다. 서버는127.0.0.1에만 바인딩한다.

Windows curl은 개발 인증서의 폐기 조회 주소 부재로 CRYPT_E_NO_REVOCATION_CHECK를 반환했다. 진단 명령에서만 `--ssl-revoke-best-effort`로 주소가 없는 경우를 처리했고 인증서 체인·호스트 검사/OS 설정은 유지했다. `-k`나 시스템 신뢰 완화는 하지 않았다.

Notion 기능13과 인증 기능02 기록을 갱신하고 기능13을 다시 읽어 최신 결과가 저장됨을 확인했다. 기존 feature branch와 미커밋 작업을 보존하며 자동 병합·푸시는 하지 않는다. 다음 개발은 시작 잔액·원자적 계좌 이체다.
