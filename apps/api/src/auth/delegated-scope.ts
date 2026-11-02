import { SetMetadata } from "@nestjs/common";
import type { DelegatedClientChannel, DelegatedScope } from "@account-book/contracts/internal-api";

/** Metadata key kept private to the Nest route boundary. */
export const DELEGATED_SCOPE = Symbol("DELEGATED_SCOPE");
export const DELEGATED_CHANNELS = Symbol("DELEGATED_CHANNELS");

/** @param channels 서버가 허용한 인증 경로 목록. JWT 검증 이후 적용하며 클라이언트 헤더는 사용하지 않는다. */
export const RequireDelegatedChannels = (...channels: DelegatedClientChannel[]) => SetMetadata(DELEGATED_CHANNELS, Object.freeze([...channels]));

/**
 * 컨트롤러 경로가 요구하는 권한을 Nest 메타데이터로 선언한다.
 * 가드는 이 선언이 없거나 잘못된 경로를 거부하므로 새 경로에 기본 권한이 생기지 않는다.
 * @param scope - 공유 계약에 정의된 경로별 위임 권한.
 * @returns 클래스나 메서드에 권한 메타데이터를 붙이는 데코레이터.
 */
export const RequireDelegatedScope = (scope: DelegatedScope) => SetMetadata(DELEGATED_SCOPE, scope);
