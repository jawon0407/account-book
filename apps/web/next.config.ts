import type { NextConfig } from "next";
import { resolve } from "node:path";

/**
 * Fails while loading Next.js configuration when a test-only adapter reaches production.
 * @param environment - Server process variables; no secret values are read or retained.
 */
function assertProductionAuthAdapter(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (
    environment.NODE_ENV === "production" &&
    environment.AUTH_ADAPTER_MODE === "fake"
  ) {
    throw new Error("AUTH_CONFIGURATION_INVALID");
  }
}

assertProductionAuthAdapter(process.env);

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: resolve(import.meta.dirname, "../..") },
};

export default config;
