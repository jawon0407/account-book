# Database Documentation

ERD, table contracts, constraints, indexes, RLS policies, transaction boundaries, sync cursors, and migration runbooks belong here.

- [인증 데이터베이스 스키마](auth-schema.ko.md): `app_private`의 6개 인증 테이블, role 권한, process-shared DB client와 request-scoped repository, migration 순서를 정의합니다.
- [은행 연결 저장소](bank-connections.ko.md): 은행 연결 신청·연결·암호화 자격정보 3개 테이블의 구현 범위와 검증 기록입니다. 이번 개발 Supabase 적용 여부와 별개입니다.
- [회원·금융 전체 기본 스키마 설계](../superpowers/specs/2026-09-29-core-database-schema-design.md): 신규 8개 테이블의 관계·열·권한·테스트·예상 변경 파일을 정리한 검토용 설계입니다. SQL 구현 및 개발 DB 적용 완료 문서가 아닙니다.

현재 같은 private schema에 별도 `app_private.api_jwt_replays` 테이블도 있습니다. 이는 같은 위임 JWT가 두 번 사용되지 못하게 하는 저장소이며 거래 원장이 아닙니다. 총 4개 SQL migration이 인증·replay 기반을 정의합니다.

금융 계좌·카테고리·거래·이체·멱등성 기록의 실제 SQL 테이블은 아직 없습니다. [공개 계약](../../packages/contracts/README.md)은 입력과 응답의 모양을 정할 뿐 DB를 생성하지 않습니다. 다음 구현은 사용자별 소유권·복합 외래 키·RLS·원자적 이체를 갖춘 금융 저장 계층입니다.

초급 개발자는 [코드 읽기 가이드](../guides/code-reading.ko.md)의 DB 용어부터 읽고 상세 스키마로 이동하면 됩니다.
