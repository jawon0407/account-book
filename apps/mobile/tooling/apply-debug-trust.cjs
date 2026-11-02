// Local build tool: never imported by application code or executed by release builds.
const { X509Certificate } = require('node:crypto');
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

/** Apply a public CA to an existing generated Android debug source set only. */
function main(androidPath, certificatePath) {
  if (!androidPath || !certificatePath || process.argv.length !== 4) throw Error('INVALID_ARGUMENTS');
  const debug = join(resolve(androidPath), 'app/src/debug');
  const manifestPath = join(debug, 'AndroidManifest.xml');
  const manifest = readFileSync(manifestPath, 'utf8');
  const pem = readFileSync(certificatePath, 'utf8').trim();
  if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----$/u.test(pem)) throw Error('PUBLIC_CERTIFICATE_REQUIRED');
  const certificate = new X509Certificate(pem);
  if (!certificate.ca || Date.parse(certificate.validTo) <= Date.now()) throw Error('VALID_CA_REQUIRED');
  if (!/<application\s/u.test(manifest) || /android:networkSecurityConfig/u.test(manifest)) throw Error('DEBUG_MANIFEST_CONFLICT');
  for (const path of ['res/raw/account_book_test_ca.pem', 'res/xml/account_book_debug_network.xml']) {
    if (existsSync(join(debug, path))) throw Error('DEBUG_RESOURCE_ALREADY_EXISTS');
  }
  mkdirSync(join(debug, 'res/raw'), { recursive: true });
  mkdirSync(join(debug, 'res/xml'), { recursive: true });
  writeFileSync(join(debug, 'res/raw/account_book_test_ca.pem'), `${pem}\n`);
  writeFileSync(join(debug, 'res/xml/account_book_debug_network.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false"><trust-anchors><certificates src="system" /></trust-anchors></base-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain>localhost</domain><domain>127.0.0.1</domain>
    <trust-anchors><certificates src="@raw/account_book_test_ca" /></trust-anchors>
  </domain-config>
</network-security-config>
`);
  writeFileSync(manifestPath, manifest.replace(/<application\s/u, '<application android:networkSecurityConfig="@xml/account_book_debug_network" '));
  console.log('DEBUG_LOCALHOST_TRUST_APPLIED');
}
try { main(...process.argv.slice(2)); } catch { console.error('DEBUG_TRUST_SETUP_REFUSED'); process.exitCode = 1; }
