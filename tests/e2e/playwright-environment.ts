type Environment = Readonly<Record<string, string | undefined>>;
type ChildEnvironment = Readonly<Record<string, string>>;

/**
 * Removes every E2E security-boundary variable before a child process receives its
 * explicit allowlist. Unrelated OS and toolchain variables stay available to builds.
 */
const securityBoundaryVariables = [
  "API_DATABASE_URL",
  "API_INTERNAL_URL",
  "AUTH_CSRF_HMAC_KEY",
  "AUTH_JWKS_URL",
  "AUTH_JWT_ALGORITHM",
  "AUTH_JWT_AUDIENCE",
  "AUTH_JWT_ISSUER",
  "AUTH_TOKEN_KEY",
  "AUTH_TOKEN_KEY_ID",
  "AUTH_TOKEN_PREVIOUS_KEYS",
  "BFF_AUTH_DISABLED",
  "BFF_JWT_ACCEPTED_KIDS",
  "BFF_JWT_KEY_ID",
  "BFF_JWT_PRIVATE_KEY",
  "BFF_JWT_PUBLIC_KEYS",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "TEST_DATABASE_DISPOSABLE",
  "TEST_DATABASE_URL",
] as const;

/**
 * Starts from inherited non-security variables and adds only the supplied child
 * process trust-boundary settings. Callers must supply every required setting.
 * @param inherited - Parent process environment.
 * @param allowed - Explicit values appropriate for one E2E child process.
 * @returns Isolated child environment without inherited boundary credentials.
 */
export function createE2eChildEnvironment(inherited: Environment, allowed: ChildEnvironment): ChildEnvironment {
  const child: Record<string, string> = {};
  for (const [variable, value] of Object.entries(inherited)) {
    if (typeof value === "string" && !securityBoundaryVariables.includes(variable as typeof securityBoundaryVariables[number])) child[variable] = value;
  }
  return { ...child, ...allowed };
}
