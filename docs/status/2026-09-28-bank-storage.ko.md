# 10-A2.1 계좌 연결 저장 구조 진행 기록

## 현재 위치

선행 A1 PR #13은 main `e23271e364eeaee0e751f1d35e4397a4ef174dbe`에 병합됐다. push36401595302·PR36401600908의 필수13단계와 PR 검사 부모 `[e43260d,435b21a]`, main36402134184의 실제 병합 근거/품질 검사가 모두 성공했다. 코드 저장소 공개가 DB 공개·서비스 배포를 뜻하지는 않는다.

현재 `feature/bank-connection-storage`에서 A2.1을 진행한다. [설계](../superpowers/specs/2026-09-28-bank-storage-design.md)와 [계획](../superpowers/plans/2026-09-28-bank-storage.md)을 먼저 작성했고 사용자 요청에 따라 일반 개발 재승인은 기다리지 않는다.

## 작업 체크

- [x] A1 정상 PR/main 통합 증거 확인
- [x] A2.1 상세 설계·대안·파일 지도·제약·권한 기준 작성
- [x] provider_subject 암호화 회귀:14개 중1실패 RED →14/14 GREEN
- [x] 전체 verify1,188개·lint·타입·빌드 종료0 (DB 테스트 별도)
- [ ] 실제 PostgreSQL 저장/권한 RED 확인
- [ ] SQL·Drizzle 구현 후 실제 DB GREEN
- [ ] 독립 리뷰·PR·main 사후 검사
- [ ] A2.2 원자적 상태 처리, A2.3 공유 요청 제한·만료 정리

## 검증 구분

로컬에 PostgreSQL/Docker가 없어 DB는 기존 무료 GitHub Actions PostgreSQL17에서 검증한다. 준비된 테스트를 실행 완료로 표시하지 않는다. A2.1은 테이블/권한 기반이며 HTTP API·은행 Callback·웹 버튼·실은행 조회는 후속이다.

## 사용자가 알아둘 사항

지금은 새 결제·실계좌 동의·운영 secret 입력이 필요하지 않다. 공식 KFTC 테스트와 운영 연결 단계에서 등록 주소·플랫폼 접근·이용 자격/동의가 필요하면 해당 단계와 영향을 별도로 알린다. 비밀값은 문서나 노션에 복사하지 않는다.

진행 보드: [가계부 기능 개발 현황](https://app.notion.com/p/817d15a21e174eac86a7d3608a21b457). A1·A2.1·A2.2·A2.3과 전체10번 기능 완료를 구분한다.
