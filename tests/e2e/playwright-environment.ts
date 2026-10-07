type Environment = Readonly<Record<string, string | undefined>>;
type ChildEnvironment = Readonly<Record<string, string>>;

/**
 * 환경변수 이름을 대문자로 정규화하여 E2E 보안 경계 설정인지 분류한다.
 * @param variable - 부모 프로세스 환경변수의 이름이다.
 * @returns 인증·API·DB 등 격리할 설정 이름이면 true. 값은 읽지 않는다.
 */
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
 * 부모의 일반 환경변수만 복사하고 명시한 자식 보안 설정을 덮어쓴다.
 * @param inherited - 부모 프로세스 환경변수. 보안 설정은 대소문자와 무관하게 제거한다.
 * @param allowed - 이 자식 프로세스에 명시적으로 허용할 문자열 설정이다.
 * @returns 분리된 새 환경 객체. 원본 환경이나 프로세스는 변경하지 않는다.
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
 * 테스트 IDP·API·웹 서버의 환경을 분리하고 키의 전달 방향을 고정한다.
 * @param input - 폐기용 DB URL, baseURL, 부모 환경, csrf/session 키와 위임 개인/공개 키다.
 * @returns idp/api/web 환경 객체. API에는 공개 키, BFF에는 개인 키를 전달하며 서버 실행은 하지 않는다.
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
      AUTH_ENABLED_PROVIDERS: '["google","kakao","naver"]',
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
