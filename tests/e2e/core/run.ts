import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import setup from "./setup.js";

// globalSetup의 정리는 webServer 종료보다 먼저 호출된다. 별도 실행기로 종료 순서를 보장한다.
// 설정 검증과 DB 생성은 setup에서 loopback 폐기용 DB에 한해서만 허용한다.
const cleanup = await setup();
try {
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/@playwright/test/cli.js", import.meta.url)), "test", "--config", "core/playwright.config.ts"], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  // Playwright가 자신이 띄운 서버들을 종료한 뒤 이번 실행의 DB/테스트 소유 역할만 제거한다.
  await cleanup();
}
