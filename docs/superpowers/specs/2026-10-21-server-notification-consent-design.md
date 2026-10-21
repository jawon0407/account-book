# 서버 알림 동의·철회 검증 설계

## 목적과 범위

휴대폰에 저장한 동의만 믿지 않고 서버에서 현재 사용자·설치의 동의 상태를 검증한다. 기존 작업은 `ae6743e`로 커밋·푸시했다. 이번 단계는 서버 계약/DB/API와 자동 기록 실행기의 안전장치다. Android UI의 서버 호출 연결, 실제 알림 읽기/업로드, 운영 DB 적용과 외부 배포는 다음 단계다. 기존 로컬 동의를 서버 동의로 자동 승격하지 않는다.

## 상태와 흐름

1. Android 인증 세션으로 상태를 조회한다. 요청에서 회원/설치 ID를 받지 않는다.
2. 사용자가 고지 `notification-access-v1`에 명시적으로 동의하면 현재 버전과 함께 accept를 보낸다.
3. 서버는 사용자+설치별 최신 상태만 저장한다. 동의 시각/철회 시각은 서버가 만든다. 원문/금융정보/기기 이름/토큰을 저장하지 않는다.
4. withdraw는 처음 동의하지 않은 상태에서도 버전을 올린다. 따라서 먼저 보낸 늦은 accept가 철회를 되돌릴 수 없다.
5. 자동 기록은 같은 DB transaction 안에서 유효한 Android 세션, 현재 1대 수집 지정 버전, 동의 버전 및 고지 버전을 모두 검사한다. 수기 입력은 영향받지 않는다.

동의 상태: `not_granted`(행 없음, version 0), `granted`, `withdrawn`, `outdated`. 응답은 `{version,state,noticeVersion}`이며 noticeVersion은 현재 요구 고지 버전이다. 새 로그인도 같은 설치 ID면 상태를 공유하지만 새 설치/다른 회원은 공유하지 않는다. 앱 삭제/로그아웃이 서버 동의 철회와 같지는 않다. 원격 로그아웃은 세션 검증으로 자동 쓰기를 차단한다.

## 데이터·권한

비공개 `app_private.notification_consent`: `(user_id,device_id)` 복합 PK, `version`, `notice_version`, `accepted_at`, `withdrawn_at`, `updated_at`. user 삭제 시 cascade. 상태 변경마다 양수 버전 증가, int 최대치에서 실패한다. 최신 상태만 보관하며 불변 감사 이력이나 법적 동의 증빙 완성으로 표현하지 않는다.

FORCE RLS, 일반/공개/서비스/BFF/API 역할의 직접 테이블 권한 없음. 제한된 SECURITY DEFINER 함수만 app_api에 허용한다. 빈 search_path와 명시적 스키마, 기존 검증된 세션/user 문맥으로 소유권을 확인한다. 기존 lease 함수는 하위 검증 도구로 유지하되 자동 기록 실행기는 새 복합 검증 함수만 호출한다.

## HTTP 계약

- GET/PATCH `/v1/collector/consent`; BFF `/api/native/collector/consent`.
- Android 채널만, 기존 `collector:read`/`collector:write` 범위. no-store. GET의 query도 금지.
- accept: `{action:"accept",expectedVersion:0,noticeVersion:"notification-access-v1"}`.
- withdraw: `{action:"withdraw",expectedVersion:1}`.
- 알 수 없는 필드/고지 버전/음수 버전 거부. ID/시각 위조 입력 거부.
- 기존 COLLECTOR_VALIDATION_FAILED(400), COLLECTOR_VERSION_CONFLICT(409), COLLECTOR_SERVICE_UNAVAILABLE(503), AUTH_SESSION_EXPIRED(401) 오류 계약 재사용. 실패한 변경은 자동 재시도하지 않고 상태 재조회한다.

## 동시성

자동 쓰기 잠금 순서: session → lease → consent. 동의 변경: session → consent. 철회가 먼저 commit되면 이전 동의 버전 쓰기는 차단된다. 쓰기가 먼저 공유 잠금을 잡았으면 철회는 그 transaction 종료까지 기다린다. 이미 완료된 거래를 소급 삭제하지 않는다. 잠금 대기 후 세션 만료를 다시 확인한다. 동의 재허용 후에도 옛 버전은 무효다.

## 검증과 완료 조건

계약/HTTP 위조·다른 채널·잘못된 scope·응답 노출, 실제 폐기용 PostgreSQL의 계정/설치 격리·철회·지연 요청·재동의·동시성·최소 권한·rollback을 검증한다. PC Playwright로 기존 조회/로그아웃 회귀 확인. 사용자 실금융/운영 DB/알림 본문은 사용하지 않는다.

공식 참고: [DB 함수 권한](https://supabase.com/docs/guides/database/functions), [PostgreSQL 잠금](https://www.postgresql.org/docs/current/explicit-locking.html).
