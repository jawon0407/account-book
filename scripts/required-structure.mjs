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
 * 저장소에 반드시 있어야 할 경로를 병렬로 확인하고 없는 경로를 입력 순서대로 모은다.
 * 파일 내용을 읽거나 만들지 않고 접근 가능 여부만 확인한다.
 * @param {string} rootDir 필수 경로의 기준이 될 절대 또는 상대 디렉터리.
 * @param {readonly string[]} [requiredPaths=REQUIRED_PATHS] 확인할 상대 경로 목록.
 * @returns {Promise<string[]>} 존재하지 않는 경로 목록. 모두 있으면 빈 배열.
 * @throws {TypeError} 루트가 빈 값이거나 경로 목록에 문자열이 아닌 값이 있으면 발생한다.
 * @throws 파일 부재(ENOENT) 이외의 접근 오류는 누락으로 숨기지 않고 호출자에게 전달한다.
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
