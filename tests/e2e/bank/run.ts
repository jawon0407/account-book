import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import setup from "../core/setup.js";

// 기존 DB는 거부하고 이번 호출이 만든 DB만 소유한다. 서버 종료 후 DB를 정리한다.
const cleanup = await setup(true);
try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)), "test", "--config", "bank/playwright.config.ts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit",
    });
    child.once("error", reject); child.once("exit", code => resolve(code ?? 1));
  });
} finally { await cleanup(); }
