import { SetMetadata } from "@nestjs/common";
import type { DelegatedScope } from "@account-book/contracts/internal-api";

/** Metadata key kept private to the Nest route boundary. */
export const DELEGATED_SCOPE = Symbol("DELEGATED_SCOPE");

/**
 * 컨트롤러 경로가 요구하는 권한을 Nest 메타데이터로 선언한다.
 * 가드는 이 선언이 없거나 잘못된 경로를 거부하므로 새 경로에 기본 권한이 생기지 않는다.
 * @param scope - 공유 계약에 정의된 경로별 위임 권한.
 * @returns 클래스나 메서드에 권한 메타데이터를 붙이는 데코레이터.
 */
export const RequireDelegatedScope = (scope: DelegatedScope) => SetMetadata(DELEGATED_SCOPE, scope);
