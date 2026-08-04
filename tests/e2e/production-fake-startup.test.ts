import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const webDirectory = fileURLToPath(new URL("../../apps/web", import.meta.url));
const MAX_DIAGNOSTIC_BYTES = 16_384;

/**
 * Keeps process diagnostics bounded so a failing startup cannot flood CI logs.
 * @param current - Previously retained diagnostic text.
 * @param chunk - Newly emitted stdout or stderr data.
 */
function appendDiagnostic(current: string, chunk: unknown): string {
  return `${current}${String(chunk)}`.slice(0, MAX_DIAGNOSTIC_BYTES);
}

test("production refuses the fake authentication adapter before readiness", async () => {
  const child = spawn(
    "pnpm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", "4513"],
    {
      env: {
        ...process.env,
        APP_ORIGIN: "https://localhost",
        AUTH_ADAPTER_MODE: "fake",
        CI: "true",
        NODE_ENV: "production",
      },
      cwd: webDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    },
  );

  let diagnostic = "";
  child.stdout.on("data", (chunk) => {
    diagnostic = appendDiagnostic(diagnostic, chunk);
  });
  child.stderr.on("data", (chunk) => {
    diagnostic = appendDiagnostic(diagnostic, chunk);
  });

  const exitResult = new Promise<Readonly<{ code: number | null; timedOut: false }>>(
    (resolve) => {
      child.once("exit", (code) => resolve({ code, timedOut: false }));
    },
  );
  const result = await Promise.race([
    exitResult,
    new Promise<Readonly<{ code: null; timedOut: true }>>((resolve) => {
      setTimeout(() => resolve({ code: null, timedOut: true }), 8_000).unref();
    }),
  ]);

  if (result.timedOut) {
    child.kill();
    await exitResult;
  }

  assert.equal(result.timedOut, false, "production fake server reached or waited for readiness");
  assert.notEqual(result.code, 0);
  assert.doesNotMatch(diagnostic, /Ready/iu);
  assert.match(diagnostic, /AUTH_CONFIGURATION_INVALID/u);
});
