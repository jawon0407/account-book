type Environment = Readonly<Record<string, string | undefined>>;
type ChildEnvironment = Readonly<Record<string, string>>;

/** Returns whether a name belongs to an E2E security boundary, regardless of Windows casing. */
function isSecurityBoundaryVariable(variable: string): boolean {
  const normalized = variable.toUpperCase();
  return normalized === "APP_ORIGIN"
    || normalized === "DATABASE_URL"
    || normalized.endsWith("_DATABASE_URL")
    || normalized.startsWith("API_")
    || normalized.startsWith("AUTH_")
    || normalized.startsWith("BFF_")
    || normalized.startsWith("SUPABASE_")
    || normalized.startsWith("TEST_DATABASE_")
    || normalized.startsWith("MIGRATION_DATABASE_");
}

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
    if (typeof value === "string" && !isSecurityBoundaryVariable(variable)) child[variable] = value;
  }
  return { ...child, ...allowed };
}

export type PlaywrightServerEnvironmentInput = Readonly<{
  apiDatabaseUrl: string;
  baseURL: string;
  csrfKey: string;
  databaseUrl: string;
  delegatedPrivateKey: string;
  delegatedPublicKey: string;
  inherited: Environment;
  sessionKey: string;
}>;

export type PlaywrightServerEnvironments = Readonly<{
  api: ChildEnvironment;
  idp: ChildEnvironment;
  web: ChildEnvironment;
}>;

/**
 * Builds the actual Playwright IDP, API, and BFF child environments from explicit
 * E2E values after case-insensitive boundary filtering of inherited process state.
 * @param input - Disposable database, runtime URLs, delegated key direction, and fresh BFF secrets.
 * @returns Isolated environments for the three local server processes.
 */
export function buildPlaywrightServerEnvironments(input: PlaywrightServerEnvironmentInput): PlaywrightServerEnvironments {
  return {
    idp: createE2eChildEnvironment(input.inherited, {}),
    api: createE2eChildEnvironment(input.inherited, {
      API_DATABASE_URL: input.apiDatabaseUrl,
      API_HOST: "127.0.0.1",
      API_PORT: "4511",
      BFF_AUTH_DISABLED: "false",
      BFF_JWT_ACCEPTED_KIDS: JSON.stringify(["e2e-bff-a"]),
      BFF_JWT_PUBLIC_KEYS: JSON.stringify({ "e2e-bff-a": input.delegatedPublicKey }),
    }),
    web: createE2eChildEnvironment(input.inherited, {
      API_INTERNAL_URL: "http://127.0.0.1:4511",
      APP_ORIGIN: input.baseURL,
      AUTH_ADAPTER_MODE: "fake",
      AUTH_CSRF_HMAC_KEY: input.csrfKey,
      AUTH_FAKE_PROVIDER_URL: "http://127.0.0.1:4510/token",
      AUTH_TOKEN_KEY: input.sessionKey,
      AUTH_TOKEN_KEY_ID: "e2e-current",
      BFF_JWT_KEY_ID: "e2e-bff-a",
      BFF_JWT_PRIVATE_KEY: input.delegatedPrivateKey,
      DATABASE_URL: input.databaseUrl,
      NODE_ENV: "test",
    }),
  };
}
