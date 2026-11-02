# A2.2 은행 연결 상태 처리 — 로컬 진행 기록

## 사용자 결정과 현재 범위

실제 계좌 조회 연동을 목표로 하되 우선 테스트 환경부터 진행한다. 수동 시작 잔액·이체 화면 확장은 후순위다. 기존 A1 암호화/A2.1 저장 구조에 이어 A2.2의 시작·콜백·교환·종료 함수6개를 구현했다. 이것은 은행 HTTP 연결 완료가 아니다.

기준 branch `feature/bank-state-transitions`, HEAD `4f080327047f18139f1b2fe4166aba8b121acd5e`. 기존 미커밋 인증·거래 작업은 보존했다. 이번 작업은 커밋·푸시·운영 DB 적용·실계좌 호출을 하지 않는다.

## 작업/검증

- [x] 기존 Notion 10-A/A2 설계와 코드 확인, 상세 설계·파일 계획 작성
- [x] 기존 은행 DB 기준선90개 통과
- [x] 시작/Callback RED6개(함수 부재) → 기존 포함96개 GREEN
- [x] 교환/종료 RED14개(함수 부재) → intake 포함20개 GREEN
- [x] 독립 PostgreSQL 연결로 경쟁 start/Callback/claim/완료/취소와 잠금 후 만료 확인
- [x] 전체 실제 DB271개/20파일 통과(기존242+신규29)
- [x] 일반 전체 테스트1,598개·lint·타입 검사 통과
- [x] 독립 리뷰: Critical0/Important0/Minor1, PC 로컬 로그인 Playwright smoke 콘솔 오류0/경고0

새 SQL3개, 테스트3개, 지원코드 신규1/변경1, 설계/계획/진행/가이드 갱신. 새 의존성·웹 UI·API 경로는 없다. [초급 개발자 설명](../database/bank-connections.ko.md), [함수 계약과 문의 문안](../superpowers/specs/2026-10-01-bank-state-transitions-design.md), [실행 계획](../superpowers/plans/2026-10-01-bank-state-transitions.md).

최종 확인은 한국 시간2026-10-02에 끝났다. 일반 테스트는 legacy207+contracts89+DB package19+API238+web959+CI policy86=1,598개다. 별도의 PostgreSQL271개는 타입 수정 후 재실행했고20파일 모두 통과했다. NULL proof 거부 테스트의 의도적인 잘못된 입력을 표현하는 Buffer 타입이 너무 넓어 첫 타입 검사가 실패했다. fixture의 정확한 타입으로 수정했으며 제품 검증을 완화하지 않았다.

독립 리뷰의 비차단 의견1개: 두 연결을 사용하는 경쟁 테스트 일부는 Promise.all만으로 실제 동시 잠금 대기를 보장하지 않는다. 잠금 대기를 직접 확인하는 만료 테스트는 있지만, 나머지 경쟁 테스트도 양쪽 실행 순서를 강제하는 보강은 후속으로 기록했다. HTTP 세션 검증·공급자 호출 전 commit, 공유 제한·자동 정리, 실제 토큰 검증·KFTC 연결·대상 Supabase 역할 호환성은 이번 리뷰의 판단 대상이 아니다. 신규 은행 UI가 없으므로 로그인 smoke를 은행 연결 E2E 성공으로 표시하지 않는다. 새 빌드·원격 CI·의존성 audit는 이번 묶음에서 실행하지 않았다.

## 다음 단계와 외부 조건

1. A2.3 공유 요청 제한·만료 코드/불명확한 교환 정리.
2. A3 NestJS provider adapter·시작/Callback/완료/상태 endpoint. 사용자 세션과 code 교환 commit 경계 검증.
3. A4 BFF·확인 쿠키·PC 연결 화면과 Playwright 정상/실패/재사용 테스트.
4. A6 공식 테스트: 최신 명세, 테스트 서비스 키 연결·데이터 등록, 허용 Callback와 서버 secret 설정을 확인 후 수행.
5. 잔액·거래 조회/저장, 중복 수집 방지, 이후 자동 갱신·알림. 실계좌 운영은 이용 자격·계약·승인 별도.

이번 테스트는 로컬 합성 데이터와 PostgreSQL만 사용했다. DB 봉투 형식 테스트는 유효 은행 토큰의 증명이 아니며, 실제 암호화 검증은 A1이 담당한다. 자동 정리·공유 rate limit·HTTP·공식 테스트가 남아 있으므로 은행 연결 활성화/출시 완료로 표시하지 않는다.
