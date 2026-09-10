import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/server/security/session-selector.ts",
        "src/server/security/token-envelope.ts",
        "src/server/security/auth-cookie.ts",
        "src/server/security/csrf.ts",
        "src/server/security/request-origin.ts",
        "src/server/persistence/auth-repository.ts",
        "src/server/persistence/postgres-auth-repository.ts",
        "src/server/session/session-service.ts",
        "src/server/auth/auth-provider-port.ts",
        "src/server/auth/supabase-auth-adapter.ts",
        "src/server/auth/supabase/error-mapper.ts",
        "src/server/auth/supabase/http-client.ts",
        "src/server/auth/supabase/sdk-client.ts",
        "src/server/auth/supabase/session-parser.ts",
        "src/server/auth/supabase/validation.ts",
        "src/server/auth/email-auth-service.ts",
        "src/server/auth/fake-auth-provider.ts",
      ],
      exclude: ["src/**/*.test.ts", "src/server/auth/supabase/test-fixtures.ts"],
      thresholds: {
        branches: 100,
      },
    },
  },
});
