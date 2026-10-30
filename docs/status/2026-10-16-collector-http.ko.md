# Android 수집 기기 설정 API — 로컬 구현 기록

## 이번에 사용 가능해진 서버 기능

Android 이메일 인증 세션으로 자동 수집 상태를 조회하고, 현재 기기에서 켜고, 다른 기기에서 넘겨받거나 해제하는 API를 구현했다. **휴대폰 앱 화면·APK·알림 수집 서비스는 아직 없다.** iOS는 Android 승인 범위 구현과 실기기 검증 이후 진행한다.

장부 기록 권한과 자동 수집 권한은 다르다. 여러 기기에서 로그인하고 수기로 입력할 수 있지만, 자동 알림 저장은 선택한 한 세션에서만 허용하는 방향이다. 이번 API는 그 세션을 지정하는 설정 기능이며 알림 거래를 접수하는 기능이 아니다.

## 초급 개발자용 요청 흐름

1. 앱이 로그인 때 받은 불투명 bearer 자격 증명으로 `/api/native/collector`를 호출한다. 비밀번호나 은행 키를 매번 보내지 않는다.
2. Next BFF가 서버 세션을 확인한다. 사용자·세션·Android 채널은 서버가 결정한다. 요청마다 경로·메서드·본문·scope에 묶인 짧은 JWT를 Nest API에 보낸다.
3. Nest의 인증 guard가 서명과 해당 작업 권한을 검사한다. 웹 채널은 수집 설정에 접근할 수 없다.
4. 저장소가 같은 사용자 transaction에서 `collector_status` 또는 `collector_change`를 호출한다. DB는 세션 소유자·만료·철회 상태와 설정 version을 다시 검사한다.
5. commit이 끝나면 버전과 `inactive`, `active_here`, `active_elsewhere` 중 하나만 반환한다. 다른 기기의 세션 ID·토큰·알림 원문은 반환하지 않는다.

예: A 기기에서 `{action:"activate",expectedVersion:0,replaceExisting:false}` → 버전1 활성. B 기기는 `active_elsewhere`를 본다. B가 최신 버전1과 `replaceExisting:true`로 바꾸면 버전2가 된다. 오래된 버전1 요청은 409 충돌이며 현재 상태를 다시 읽어야 한다. PATCH 응답이 유실돼도 무조건 다시 보내지 않는다.

`get(userId,sessionId)`는 검증된 회원·서버 세션으로 상태를 읽는다. `change(userId,sessionId,input)`은 활성/해제, 기대 버전, 명시적 교체 선택을 받는다. 클라이언트 본문의 `userId`, `sessionId`, `deviceId`는 허용하지 않는다. 자격 증명 갱신은 같은 sid여서 설정을 유지하지만, 로그아웃 후 재로그인하면 다시 활성화해야 한다.

## 변경 파일과 규모

제품11·테스트/시험설정9·문서4, 총24파일의 중간 규모다. 기존 혼합 미커밋 변경은 보존했다. 새 패키지·새 DB migration·운영 설정은 추가하지 않았다.

| 역할 | 파일 |
| --- | --- |
| 입력/출력과 타입 | `packages/contracts/src/collector.ts`, index/errors/internal-api 확장 |
| Nest 인증 후 작업 분기·저장소 | `apps/api/src/collector/collector.controller.ts`, `collector.repository.ts`, core.module 등록 |
| 앱용 고정 경로 | `apps/web/src/app/api/native/collector/route.ts` |
| 공통 BFF 작업·채널·오류 | core의 operations/core-controller/http-boundary |
| 계약·단위·실제 JWT HTTP | collector.test, collector.repository.test, core-http.test, native-core-controller/native-routes |
| 실제 최소 권한 DB | `tests/database/collector-repository.test.ts` |
| Next/Nest/DB·PC 회귀 | `tests/e2e/core/native-collector.spec.ts`, setup/config |

설계: [HTTP 계약](../superpowers/specs/2026-10-16-collector-http-design.md). 실행 계획: [작업별 계획](../superpowers/plans/2026-10-16-collector-http.md). 기존 DB 기반: [lease 보고](2026-10-16-collector-lease.ko.md).

## 실행 증거와 중간 실패

- 구현 전 공유 계약/저장소 모듈 부재로 3 suite 실패 → 계약26개, API50개(기존 포함) 통과.
- BFF 고정 작업·route가 없어서 새14개 실패 → 구현 후 기존 포함58개 통과.
- 저장소의 잘못된 rows 시험에서 Vitest each 배열을 인수로 펼쳐 테스트1개가 잘못 동작했다. fixture를 객체로 감싸 수정했다. 제품 결함으로 세지 않는다.
- 최초 전체 verify는 테스트 mock의 미사용 인수 린트1건으로 중단했다. 수정 후 `pnpm verify` 종료0: 린트·6 workspace 타입·1,961개 테스트(legacy208/contracts124/DB단위19/API318/web1206/preflight86)·API/웹 production build 통과.
- 전체 실제 폐기용 PostgreSQL355개/32파일 통과. 이번 저장소2개는 새 동작을 처음부터 RED로 검증한 것이 아니라 구현 후 통합 회귀다.
- core Playwright18개/44.1초·종료0. 기존 PC 회귀와 두 Android 세션/별도 계정·교체·갱신·로그아웃·브라우저 차단을 실제 Next/Nest/DB 경로로 확인했다. 합성 인증이며 Android 실기기 시험은 아니다.
- 운영/전체 의존성 감사는 알려진 취약점0. 등록된 AWS/GitHub/개인키 패턴 검사791파일/발견0(이 결과 문서 생성 전). 포괄적인 무취약점·모든 비밀 부재 보증은 아니다.

## 독립 코드·보안 리뷰

read-only 독립 리뷰1회: Critical0, Important0, Minor1. 신뢰된 sub/sid/channel, strict 계약, 최소 DB 권한, CAS, 사용자 격리, 오류 비노출, mutation 비재시도를 확인했다. 리뷰어는 공유 DB/빌드 경합을 피하기 위해 테스트를 실행하지 않았고 실행 결과는 주 작업자가 별도로 확인했다.

**보류 Minor:** 공통 BFF의 transport/출력 오류는 `502 LEDGER_SERVICE_UNAVAILABLE`, GET 본문 framing 거부는 `400 LEDGER_VALIDATION_FAILED`다. collector 설계의 오류 목록에 이 예외가 완전히 기술되지 않았다. 앱 오류 안내 구현 전에 계약을 보완해야 한다. 권한·캐시 금지·변경 비재시도는 유지된다.

이전 DB 단위 Minor2(잠금 대기 중 만료 시험, 사용자 삭제 FK cascade 시험)도 여전히 후속이다. 이미 실행한 테스트로 표시하지 않는다.

### 이번에 유지한 판단과 한계

- 혼합 작업의 원격 적용/배포/커밋은 하지 않았다. 기존 작업을 보존하지만 통합·전달 단계는 남는다.
- Autoplan 참조 누락은 직접 설계/TDD/독립 리뷰로 보완했다. 완전한 자동 리뷰 파이프라인을 실행한 것은 아니다. QA-only의 기존 도구 제한은 Playwright로 대체했다.
- 설정 GET 결과는 이후 저장의 허가증이 아니다. 후속 자동 접수는 반드시 같은 transaction의 `runCollector`를 사용해야 하며 누락하면 오래된 기기의 저장을 막을 수 없다.
- 실제 수집·APK·응답 유실 뒤 앱 GET 재확인은 후속이다. 지금은 사용자가 자동 기록을 사용할 수 있는 단계가 아니다.
- Android 채널은 설치 앱/기기 진위 증명이 아니다. 유효 자격 증명 탈취 위험은 별도 보안 경계다.
- 운영 이관·부하·한국망 지연은 미검증이다. 로컬 통과로 출시 게이트를 대체하지 않는다.
- 전체 혼합 브랜치/PR 보안 인증이 아니다. [PR #22](https://github.com/jawon0407/account-book/pull/22)는 조회 시 open/unmerged, 원격 head `264a7f6dff61622f52fadcc45feaaa69901313ca`로 유지되어 이번 로컬 변경을 포함하지 않는다. 원격 CI를 재실행하거나 결과를 개선한 것은 아니다.

## 다음 작업

1. Android 기본 앱의 버전·개발 빌드·안전 저장소·로그인/갱신 직렬화 계약을 확정하고 `apps/mobile`을 만든다. Bookify 참조는 실제 접근 가능한 화면을 확인해 적용하며 임의로 동일 디자인 완료라 하지 않는다.
2. 앱 로그인·계좌/카테고리·수기·조회와 수집 기기 설정 UI를 연결한다. 미지원 OS/알림 권한 미허용과 자동 수집 끔을 구분한다.
3. 새 알림 동의·선택 출처·검증 형식 판독·최소 접수·PC 조회를 연결한다. 금융 알림 원문을 공개 fixture/로그에 저장하지 않는다.
4. 승인된 중복/실패/규칙·정밀 시각/복수 필터·환불/복구/집계와 실기기 검증을 순차 진행한다. 시작 잔액은 구현 전 공수 보고 조건을 유지한다.

실제 Supabase 적용/배포, Android SDK·빌드 환경·실기기 권한/재부팅 시험은 별도다. 사용자의 실계좌·실제 알림으로 이번 테스트를 수행하지 않았다.
