import {
  CurrentUserSchema,
  PasswordResetRequestInputSchema,
  PasswordUpdateInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  type AuthProvider,
  type CurrentUser,
  type PasswordResetRequestInput,
  type PasswordUpdateInput,
  type SignInInput,
  type SignUpInput,
} from "@account-book/contracts";
import { mutationOptions, queryOptions, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiClient, apiError, type BrowserApiClient } from "../lib/http/api-client.js";
import { postWithCsrf } from "../lib/http/csrf-client.js";

const AcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
const SignedOutSchema = z.object({ signedOut: z.literal(true) }).strict();
const UpdatedSchema = z.object({ updated: z.literal(true) }).strict();
const SignInResponseSchema = z.object({ user: CurrentUserSchema, expiresAt: z.iso.datetime(), absoluteExpiresAt: z.iso.datetime() }).strict();
const OAuthStartResponseSchema = z.object({ authorizationUrl: z.url() }).strict();

function client(value: BrowserApiClient | typeof apiClient): BrowserApiClient {
  return value as unknown as BrowserApiClient;
}

async function parsedMutation<T>(path: string, input: unknown, schema: z.ZodType<T>, http: BrowserApiClient | typeof apiClient): Promise<T> {
  try {
    const parsed = schema.safeParse(await postWithCsrf(path, input, http));
    if (!parsed.success) throw new Error("AUTH_RESPONSE_INVALID");
    return parsed.data;
  } catch (error) {
    throw await apiError(error);
  }
}

async function currentUser(http: BrowserApiClient | typeof apiClient, refreshed: boolean): Promise<CurrentUser> {
  try {
    const parsed = CurrentUserSchema.safeParse(await client(http).get("me").json<unknown>());
    if (!parsed.success) throw new Error("AUTH_RESPONSE_INVALID");
    return parsed.data;
  } catch (error) {
    const safe = await apiError(error);
    if (!refreshed && safe.code === "AUTH_SESSION_REFRESH_REQUIRED") {
      await parsedMutation("auth/session/refresh", {}, z.object({ refreshed: z.literal(true) }).strict(), http);
      return currentUser(http, true);
    }
    throw safe;
  }
}

/** Reads the current user and performs at most one CSRF-protected refresh/retry cycle. */
export function getCurrentUser(http: BrowserApiClient | typeof apiClient = apiClient): Promise<CurrentUser> {
  return currentUser(http, false);
}

/** Creates typed current-user query options with library retries disabled. */
export function currentUserQueryOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return queryOptions({ queryKey: ["auth", "current-user"] as const, queryFn: () => getCurrentUser(http), retry: false });
}

/** React binding for the typed current-user server state. */
export function useCurrentUser() {
  return useQuery(currentUserQueryOptions());
}

/** Typed email sign-in mutation; credentials are sent once and never cached in query state. */
export function signInMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: SignInInput) => parsedMutation("auth/sign-in", SignInInputSchema.parse(input), SignInResponseSchema, http), retry: false });
}

/** Typed enumeration-resistant signup mutation. */
export function signUpMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: SignUpInput) => parsedMutation("auth/sign-up", SignUpInputSchema.parse(input), AcceptedSchema, http), retry: false });
}

/** Typed local-first sign-out mutation. */
export function signOutMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: () => parsedMutation("auth/sign-out", {}, SignedOutSchema, http), retry: false });
}

/** Typed enumeration-resistant password-reset request mutation. */
export function passwordResetMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: PasswordResetRequestInput) => parsedMutation("auth/password/reset-request", PasswordResetRequestInputSchema.parse(input), AcceptedSchema, http), retry: false });
}

/** Typed recovery-context password update mutation. */
export function passwordUpdateMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({ mutationFn: (input: PasswordUpdateInput) => parsedMutation("auth/password/update", PasswordUpdateInputSchema.parse(input), UpdatedSchema, http), retry: false });
}

/** Typed OAuth-start mutation using only approved provider and return-path values. */
export function oauthStartMutationOptions(http: BrowserApiClient | typeof apiClient = apiClient) {
  return mutationOptions({
    mutationFn: (input: Readonly<{ provider: AuthProvider; returnPath: "/app" | "/settings/security" }>) => parsedMutation(`auth/oauth/${input.provider}/start`, { returnPath: input.returnPath }, OAuthStartResponseSchema, http),
    retry: false,
  });
}
