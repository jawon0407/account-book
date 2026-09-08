import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const webDirectory = fileURLToPath(new URL("../../apps/web", import.meta.url));
const MAX_DIAGNOSTIC_BYTES = 16_384;

/**
 * 자식 프로세스 진단 문자열을 합치고 앞 16384 코드 단위까지만 보관한다.
 * @param current - 앞서 모아 둔 stdout/stderr 문자열이다.
 * @param chunk - 새로 들어온 출력 조각. String으로 변환한다.
 * @returns 길이를 제한한 새 문자열. 자체 출력이나 프로세스 변경은 없다.
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
