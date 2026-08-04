import { SetMetadata } from "@nestjs/common";
import type { DelegatedScope } from "@account-book/contracts/internal-api";

/** Metadata key kept private to the Nest route boundary. */
export const DELEGATED_SCOPE = Symbol("DELEGATED_SCOPE");

/**
 * Declares the exact delegated capability required by a controller route.
 * The guard treats missing or malformed metadata as unauthenticated, avoiding a
 * default capability when future protected handlers are added.
 * @param scope - Contract-defined capability required for the decorated route.
 */
export const RequireDelegatedScope = (scope: DelegatedScope) => SetMetadata(DELEGATED_SCOPE, scope);
