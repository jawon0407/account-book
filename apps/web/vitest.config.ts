import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/server/security/session-selector.ts", "src/server/security/token-envelope.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        branches: 100,
      },
    },
  },
});
