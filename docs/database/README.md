# Database Documentation

최신 이름(2026-09-30): 사용자 스키마는 `user`, 금융 스키마는 `finance`다. [변경·검증 기록](../status/2026-09-30-readable-schema-names.ko.md)을 확인한다. 아래 9월 29일 적용 결과의 옛 이름은 당시 이력이다.

ERD, table contracts, constraints, indexes, RLS policies, transaction boundaries, sync cursors, and migration runbooks belong here.

- [인증 데이터베이스 스키마](auth-schema.ko.md): `app_private`의 6개 인증 테이블, role 권한, process-shared DB client와 request-scoped repository, migration 순서를 정의합니다.
- [은행 연결 저장소](bank-connections.ko.md): 은행 연결 신청·연결·암호화 자격정보 3개 테이블의 구현 범위와 검증 기록입니다. 이번 개발 Supabase 적용 여부와 별개입니다.
- [회원·금융 테이블 읽기 가이드](core-schema.ko.md): 신규 8개 테이블, 가입 초기화·최초 가입 경로·탈퇴 표시, 역할·거래·이체·멱등성, 함수·권한·Table Editor 안내입니다.
- [회원·금융 전체 기본 스키마 설계](../superpowers/specs/2026-09-29-core-database-schema-design.md): 승인된 관계·열·권한과 후속 기능 경계를 설명합니다.
- [2026-09-29 개발 DB 적용 기록](../status/2026-09-29-core-schema-application.ko.md): 실제 적용 시각·기존 회원 보존·실제 역할 13개 검사·로컬 DB 193개 및 전체 1,203개 테스트 결과입니다.

현재 같은 private schema에 별도 `app_private.api_jwt_replays` 테이블도 있습니다. 이는 같은 위임 JWT가 두 번 사용되지 못하게 하는 저장소이며 거래 원장이 아닙니다. 총 4개 SQL migration이 인증·replay 기반을 정의합니다.

2026-09-29 개발 Supabase에 `app_identity` 3개와 `app_ledger` 5개 테이블을 적용했습니다. 기존 인증 7개와 합해 이번 개발 프로젝트에서 적용 확인한 앱 테이블은 15개입니다. 은행 연결 3개는 별도 적용 단계입니다. [공개 계약](../../packages/contracts/README.md)은 입력·응답의 모양을 정의하고, SQL은 저장·권한·정합성을 보장합니다. 다음 구현은 이 테이블을 사용하는 NestJS repository/CRUD API·서비스 멱등성 처리이며, 화면에서 거래를 저장하는 기능까지 완료된 상태는 아닙니다.

초급 개발자는 [코드 읽기 가이드](../guides/code-reading.ko.md)의 DB 용어부터 읽고 상세 스키마로 이동하면 됩니다.
