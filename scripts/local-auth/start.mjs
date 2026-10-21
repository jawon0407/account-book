import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { childEnvironment } from "./config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * `web` 또는 `api` 하나를 로컬 전용 주소에서 실행합니다. 관리자 파일은 읽지 않습니다.
 * 역할별 JSON은 사용자 전용 ACL 디렉터리에 있어야 합니다. 서버 로그는 OAuth code 유출 방지를 위해 캡처하지 않습니다.
 * @returns {void} 자식 서버가 종료될 때 동일 종료 코드를 반환합니다.
 */
function main() {
  const kind = process.argv[2];
  if (process.argv.length !== 3 || !["web", "api"].includes(kind)) throw new Error("LOCAL_AUTH_START_INVALID");
  const directory = join(process.env.LOCALAPPDATA, "account-book/dev-auth");
  if (!existsSync(join(directory, "applied.json"))) throw new Error("LOCAL_AUTH_NOT_PROVISIONED");
  const config = JSON.parse(readFileSync(join(directory, `${kind}.json`), "utf8"));
  const env = childEnvironment(kind, config, process.env);
  let args;
  let cwd;
  if (kind === "web") {
    if (config.APP_ORIGIN !== "https://localhost:3000" || config.API_INTERNAL_URL !== "http://127.0.0.1:3001") throw new Error("LOCAL_ORIGIN_INVALID");
    cwd = join(root, "apps/web");
    for (const name of [".env", ".env.local", ".env.development", ".env.development.local"]) {
      const path = join(cwd, name);
      if (existsSync(path) && Object.keys(parseEnv(readFileSync(path, "utf8"))).some((key) => !["SUPABASE_URL", "SUPABASE_ANON_KEY", "AUTH_ADAPTER_MODE"].includes(key))) throw new Error("LOCAL_ENV_AUTOLOAD_REFUSED");
    }
    args = [createRequire(join(cwd, "package.json")).resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3000", "--experimental-https", "--experimental-https-cert", join(directory, "localhost.pem"), "--experimental-https-key", join(directory, "localhost-key.pem")];
    for (const name of ["localhost.pem", "localhost-key.pem"]) if (!existsSync(join(directory, name))) throw new Error("LOCAL_HTTPS_CERTIFICATE_MISSING");
  } else {
    if (config.API_HOST !== "127.0.0.1" || config.API_PORT !== "3001") throw new Error("LOCAL_LISTENER_INVALID");
    cwd = join(root, "apps/api");
    args = [join(cwd, "dist/main.js")];
  }
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: "ignore" });
  child.on("error", () => { console.error("LOCAL_AUTH_SERVER_START_FAILED"); process.exitCode = 1; });
  child.on("exit", (code) => { console.log(JSON.stringify({ status: "stopped", server: kind, code })); process.exitCode = code ?? 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  console.log(JSON.stringify({ status: "starting", server: kind, pid: child.pid, address: kind === "web" ? config.APP_ORIGIN : "http://127.0.0.1:3001", logs: "suppressed-for-auth-secrets" }));
}

try { main(); } catch { console.error("LOCAL_AUTH_SERVER_CONFIGURATION_INVALID"); process.exitCode = 1; }
