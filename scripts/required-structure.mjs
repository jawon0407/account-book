import { access } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_PATHS = Object.freeze([
  "apps/web/README.md",
  "apps/api/README.md",
  "packages/contracts/README.md",
  "packages/database/README.md",
  "packages/config/README.md",
  "supabase/migrations/README.md",
  "supabase/seed/README.md",
  "docs/architecture/README.md",
  "docs/api/README.md",
  "docs/database/README.md",
  "docs/guides/README.md",
  "docs/guides/testing.md",
  "docs/roadmap/README.md",
  "docs/security/README.md",
  "tests/e2e/README.md",
  ".githooks/pre-push",
  ".github/workflows/security-gate.yml",
  ".github/CODEOWNERS",
  ".github/pull_request_template.md",
  ".github/settings/main-protection.json",
  "docs/security/free-plan-compensating-controls.md",
  "README.md",
  "SECURITY.md",
  "PRODUCT.md",
  "DESIGN.md",
  "tsconfig.base.json",
  "eslint.config.mjs",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "package.json",
]);

/**
 * Returns repository contract paths that do not exist below a root directory.
 *
 * Each path is checked independently so callers receive the complete missing
 * set in the same deterministic order as the supplied contract.
 *
 * @param {string} rootDir Absolute or relative directory used as the contract root.
 * @param {readonly string[]} [requiredPaths=REQUIRED_PATHS] Paths to verify.
 * @returns {Promise<string[]>} Missing paths in contract order.
 * @throws {TypeError} If `rootDir` is empty or a contract path is not a string.
 */
export async function findMissingPaths(
  rootDir,
  requiredPaths = REQUIRED_PATHS,
) {
  if (typeof rootDir !== "string" || rootDir.trim().length === 0) {
    throw new TypeError("rootDir must be a non-empty string");
  }

  if (requiredPaths.some((path) => typeof path !== "string")) {
    throw new TypeError("requiredPaths must contain only strings");
  }

  const checks = requiredPaths.map(async (path) => {
    try {
      await access(join(rootDir, path));
      return null;
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        return path;
      }

      throw error;
    }
  });

  return (await Promise.all(checks)).filter((path) => path !== null);
}
