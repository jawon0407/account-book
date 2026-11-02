# 개발 Supabase 인증 연결 실행 계획

> Scope: 사용자가 승인한 새 개발 프로젝트의 인증 DB·최소 권한·로컬 서버 연결. 운영 배포/은행 API/금융 테이블은 제외한다.
> Spec: `docs/guides/auth-environment.md`, `docs/database/auth-schema.ko.md`, 기존 인증 migration 4개.
> Execution: superpowers:executing-plans, 기존 feature 작업 공간 재사용.

## 변경 범위와 결정

- `scripts/local-auth/`: 설정 생성·초기화·로컬 실행 도구와 보안 경계 테스트, 약 400~600줄 예상.
- `docs/status/2026-09-29-local-supabase-auth-setup.ko.md`: 실측 결과와 미완료 항목 갱신.
- `docs/guides/local-auth-development.ko.md`: 초급 개발자용 재실행·역할 설명 추가.
- 기존 migration과 제품 인증 로직은 우선 변경하지 않는다. 통합에서 실제 결함을 발견하면 재현 테스트부터 추가한다.
- 비밀 파일은 OneDrive/Git 밖의 사용자 로컬 디렉터리에서만 생성한다. 관리자 URL은 초기화 도구만 읽고 앱에는 전달하지 않는다.
- 기존 인증 스키마가 있으면 초기화를 거부한다. DROP/reset/비밀번호 자동 교체 없이 작업을 멈춘다.
- 이메일 발송·확인은 사용자 본인이 브라우저에서 진행한다. 사회관계망 로그인 설정은 별도 작업이다.

## Task 1: 재현 가능한 안전한 설정 생성

**Files:** `scripts/local-auth/config.mjs`, `scripts/local-auth/config.test.mjs`.
**Interfaces:** 승인된 프로젝트의 migration URL → 서로 다른 BFF/API 로그인 URL, 역할별 환경, 독립 키.

1. RED: 다른 프로젝트/호스트/포트/SSL 옵션 주입 거부, 관리자 자격증명 제거, 역할별 비밀 분리, 32바이트 독립 키 테스트 작성.
2. `node --test scripts/local-auth/config.test.mjs` 실행. Expected: 미구현 계약 실패.
3. 최소 구현: 고정 개발 프로젝트·Session pooler 검증, `verify-full` CA URL, P-256 키 생성, 명시적 환경 허용 목록.
4. 같은 테스트 실행. Expected: 전체 통과.

## Task 2: 인증 DB 초기화와 최소 권한 검증

**Files:** `scripts/local-auth/provision.mjs`, 필요 시 작은 공용 helper.
**Interfaces:** Task 1의 credential → 기존 SQL 4개 → BFF/API 전용 로그인.

1. 공식 CA fingerprint, 목표 프로젝트, 양 구간 TLS, 앱 스키마·역할 부재를 다시 확인한다.
2. 한 트랜잭션으로 기존 migration을 순서대로 적용한다. pg_cron은 기존 replay migration에 정의된 만료 행 정리만 수행한다.
3. `app_session_bff`는 NOLOGIN 유지, `app_bff_login`만 로그인 가능하며 해당 그룹 권한만 상속한다. API는 `app_api` 별도 비밀번호를 쓴다.
4. 관리자 아닌 실제 역할로 별도 접속한다. 허용 동작은 rollback 트랜잭션에서 확인하고 교차 테이블 접근/DDL/권한 승격은 거부되는지 확인한다.
5. Expected: 인증 테이블 7개, 역할 속성 안전, BFF/API 교차 접근 거부, TLS 인증 통과. 실패 시 원문 오류/secret 대신 단계와 안전한 오류 코드만 출력한다.

## Task 3: 서버 연결과 사용자 여정 검증

**Files:** `scripts/local-auth/start.mjs`, 한국어 실행 가이드·상태 문서.
**Interfaces:** Task 2의 역할별 파일 → Node/Nest API와 Next BFF → 실제 Supabase Auth.

1. 기존 mkcert CA 신뢰 상태를 읽고, 이미 신뢰된 CA만 사용한다. 새 전역 신뢰 설치는 자동 진행하지 않는다.
2. BFF `https://localhost:3000`, API `127.0.0.1:3001`에 한정해 실행한다. 서버 자식 환경은 OS 필수 값과 역할별 명시적 설정만 받는다.
3. HTTPS·CSRF·비인증 session·인증 API 거부·위임 JWT 성공 및 replay 거부를 검증한다.
4. 사용자가 callback allowlist 설정 및 이메일 인증을 수행한 뒤 실제 가입·로그인을 검증한다. 완료되지 않으면 외부 단계 대기로 정확히 기록한다.
5. `pnpm test`, lint 및 관련 build를 실행하고 실패는 빠짐없이 기록한다. Expected: 코드 검증 통과; 실제 이메일 단계는 별도 증거.

## Review Focus

목표 프로젝트 제한, 기존 데이터 덮어쓰기 방지, 관리자 credential 런타임 유출, SQL 비밀번호 인코딩, OS 환경 상속, CA/hostname 검증, 역할 상속을 통한 권한 상승, 로그의 토큰 노출, 로컬 서버 외부 바인딩, 실제 provider 통합과 모의 테스트의 구분.

## 작업 중 판단

- 기존 구현이 지원하는 동일 PC loopback HTTP BFF→API를 개발 환경에 한해 사용한다. 브라우저→BFF 및 DB 양 구간은 TLS를 유지한다. 운영 API HTTPS 정책은 바꾸지 않는다. 잘못 적용하면 로컬 프로세스 간 요청이 암호화되지 않는 위험이 있으므로 `127.0.0.1` 바인딩과 개발 전용 실행기로 제한한다.
- 현재 `/app` 사용자 화면은 별도 미구현이다. 인증이 성공해도 전체 가계부 화면 구현 완료로 보고하지 않는다.
- 자동 커밋·원격 푸시는 이번 요청의 필수 결과가 아니다. 변경은 검증 후 사용자가 검토 가능한 상태로 남긴다.

## 실행 중 발견한 추가 변경

- Hosted PostgreSQL 17에서 첫 SQL의 ALTER ROLE NOSUPERUSER가 42501로 실패했다. 001/replay migration을 위험 역할 거부 + 일반 속성 정규화 방식으로 보완하고, 실제 비슈퍼유저 전체 SQL 검사를 RED→GREEN으로 검증했다. 폐기용 DB suite에도 회귀 검사를 추가했으나 이번 로컬 환경에서는 해당 suite를 실행하지 않았다.
- API 환경 검증이 Supavisor app_api.projectref 사용자명을 거부했다. 정확한 pooler 호스트·포트에서만 허용하도록 7줄을 보완하고 환경 테스트로 검증했다.
- 독립 리뷰에서 발견한 테스트 명령 정책 불일치와 NTFS ACL 사전 검사 누락을 보완했다. 별도 제품 기능/화면/금융 테이블 추가는 없다.
- 코드 검증은 완료, 실제 이메일 여정은 사용자 CA 신뢰 승인 및 callback 설정 확인 대기다. 현재 앱 화면 404를 인증 성공으로 숨기지 않는다.
