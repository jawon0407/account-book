const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

// Regression target: writing trust into main/release or accepting a private key.
test('debug trust modifies only generated debug resources and rejects private keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'account-book-debug-trust-'));
  const android = join(root, 'android');
  mkdirSync(join(android, 'app/src/debug'), { recursive: true });
  const manifest = join(android, 'app/src/debug/AndroidManifest.xml');
  writeFileSync(manifest, '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:usesCleartextTraffic="true" /></manifest>');
  const cert = join(root, 'bad.pem');
  // Construct a deliberately invalid fixture; never commit a real key or its PEM envelope.
  writeFileSync(cert, ['-----BEGIN', 'PRIVATE KEY-----'].join(' ') + '\nnot-a-certificate');
  const script = join(__dirname, 'apply-debug-trust.cjs');
  assert.ok(existsSync(script), 'debug-only trust setup tool is required');
  const rejected = spawnSync(process.execPath, [script, android, cert], { encoding: 'utf8' });
  assert.notEqual(rejected.status, 0);
  assert.equal(existsSync(join(android, 'app/src/debug/res')), false);
  assert.equal(readFileSync(manifest, 'utf8').includes('networkSecurityConfig'), false);
  assert.equal(existsSync(join(android, 'app/src/main')), false);
  const ca = require('node:tls').rootCertificates.find((pem) => Date.parse(new (require('node:crypto').X509Certificate)(pem).validTo) > Date.now());
  writeFileSync(cert, ca);
  const accepted = spawnSync(process.execPath, [script, android, cert], { encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(readFileSync(join(android, 'app/src/debug/res/raw/account_book_test_ca.pem'), 'utf8').trim(), ca.trim());
  assert.match(readFileSync(manifest, 'utf8'), /android:networkSecurityConfig=/u);
  assert.equal(existsSync(join(android, 'app/src/main')), false);
  assert.equal(existsSync(join(android, 'app/src/release')), false);
  const rerun = spawnSync(process.execPath, [script, android, cert], { encoding: 'utf8' });
  assert.notEqual(rerun.status, 0, 'must not overwrite existing trust configuration');
});
