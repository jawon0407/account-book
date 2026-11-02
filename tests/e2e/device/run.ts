import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, createWriteStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import setup from '../core/setup.js';
import { buildPlaywrightServerEnvironments } from '../playwright-environment.js';
import { stopStack } from './lifecycle.js';

// Synthetic, local-only device test stack. Never reads the provisioned hosted DB configuration.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = resolve(root, 'output/android-device-2026-10-20');
const cert = join(output, 'tls/localhost.pem');
const key = join(output, 'tls/localhost-key.pem');
if (!existsSync(cert) || !existsSync(key)) throw Error('DEVICE_TLS_NOT_READY');
const inherited = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA)$/iu.test(name)));
// Next autoloads these files. Refuse unknown settings before starting a process.
for (const name of ['.env', '.env.local', '.env.test', '.env.test.local', '.env.development', '.env.development.local']) {
  const path = join(root, 'apps/web', name);
  if (existsSync(path) && Object.keys(parseEnv(readFileSync(path, 'utf8'))).some((name) => !['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'AUTH_ADAPTER_MODE'].includes(name))) throw Error('DEVICE_ENV_AUTOLOAD_REFUSED');
}
const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const environments = buildPlaywrightServerEnvironments({
  inherited,
  apiDatabaseUrl: 'postgresql://app_api:account-book-e2e-only@127.0.0.1:5432/account_book_core_test',
  databaseUrl: 'postgresql://app_session_bff:account-book-e2e-only@127.0.0.1:5432/account_book_core_test',
  baseURL: 'https://localhost:3000',
  csrfKey: randomBytes(32).toString('base64url'), sessionKey: randomBytes(32).toString('base64url'),
  delegatedPrivateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
  delegatedPublicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
});
const cleanup = await setup(true);
const children: ChildProcess[] = [];
/** Start one owned child without exposing its environment/keys in logs. */
function start(name: keyof typeof environments, args: string[], cwd: string) {
  const log = createWriteStream(join(output, `test-${name}.log`));
  const child = spawn(process.execPath, args, { cwd, windowsHide: true, env: { ...environments[name], NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(log); child.stderr?.pipe(log);
  children.push(child);
  child.once('error', () => { console.error(`DEVICE_${name}_START_FAILED`); void stop(true); });
  child.once('exit', () => { if (!stopping) { console.error(`DEVICE_${name}_UNEXPECTED_EXIT`); void stop(true); } });
  console.log(JSON.stringify({ component: name, pid: child.pid }));
}
let stopping = false;
/** Stop only this runner's children, then remove only the database setup created. */
async function stop(failed = false) {
  if (stopping) return;
  stopping = true;
  process.exitCode = await stopStack(children, cleanup, failed);
  if (process.exitCode !== 0) console.error('DEVICE_TEST_SHUTDOWN_REQUIRES_CHECK');
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
start('idp', ['--import', 'tsx', 'tests/e2e/test-idp-server.ts'], root);
start('api', ['dist/main.js'], join(root, 'apps/api'));
start('web', [createRequire(join(root, 'apps/web/package.json')).resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3000', '--experimental-https', '--experimental-https-cert', cert, '--experimental-https-key', key], join(root, 'apps/web'));
