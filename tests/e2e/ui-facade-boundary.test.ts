import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findUiFacadeBoundaryViolations } from "./ui-facade-boundary.js";

function inspect(source: string) {
  const rootDirectory = mkdtempSync(join(tmpdir(), "ui-facade-boundary-"));
  const rootFile = join(rootDirectory, "root.ts");
  try {
    writeFileSync(rootFile, source);
    return findUiFacadeBoundaryViolations({ rootDirectory, rootFile });
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
}

function authSource(callback: string): string {
  return `
    import { authTest } from "../support/safe-ui-test.js";
    const email = "verified@example.test";
    const password = "correct horse battery staple";
    authTest("x", ${callback});
  `;
}

test("allows only the canonical safe auth UI import and grammar", () => {
  const allowed = `
    import { authTest } from "../support/safe-ui-test.js";
    const email = "verified@example.test";
    const password = "correct horse battery staple";
    authTest("successful login", async ({ authUi }) => {
      await authUi.openLogin();
      await authUi.submit({ email, password });
      await authUi.assertAuthenticated();
    });
  `;

  assert.deepEqual(inspect(allowed), []);
});

test("allows every approved zero-argument method and resolves later top-level credential declarations", () => {
  const allowed = `
    import { authTest } from "../support/safe-ui-test.js";
    authTest("all approved methods", async function ({ authUi }) {
      await authUi.openLogin();
      await authUi.assertLoginUsable();
      await authUi.assertRejected();
      await authUi.assertAuthenticated();
      await authUi.assertNoBrowserCredentials();
      await authUi.assertNoAuthorizationHeaders();
      await authUi.submit({ email, password });
    });
    const email = "verified@example.test";
    const password = "correct horse battery staple";
  `;

  assert.deepEqual(inspect(allowed), []);
});

test("rejects raw Playwright and import-shape mutations with a fixed diagnostic", () => {
  const unapprovedImports = [
    'import { test } from "@playwright/test"; void test;',
    'import authTest from "../support/safe-ui-test.js";',
    'import * as safeUi from "../support/safe-ui-test.js";',
    'import { authTest as test } from "../support/safe-ui-test.js";',
    'import { helper } from "./helper.js";',
    'import safeUi = require("../support/safe-ui-test.js");',
    'export { authTest } from "../support/safe-ui-test.js";',
    "export default 1;",
    'import { authTest } from "../support/safe-ui-test.js" with { type: "json" };',
  ];

  for (const source of unapprovedImports) {
    assert.deepEqual(
      inspect(source),
      [{ category: "import", capability: "unapproved-import" }],
    );
  }
});

test("rejects root files outside the canonical boundary and unsupported root extensions", () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "ui-facade-boundary-root-"));
  const outsideDirectory = mkdtempSync(join(tmpdir(), "ui-facade-boundary-outside-"));
  const outsideFile = join(outsideDirectory, "root.ts");
  const unsupportedFile = join(rootDirectory, "root.js");
  try {
    writeFileSync(outsideFile, "");
    writeFileSync(unsupportedFile, "");
    assert.deepEqual(
      findUiFacadeBoundaryViolations({ rootDirectory, rootFile: outsideFile }),
      [{ category: "boundary", capability: "boundary-escape" }],
    );
    assert.deepEqual(
      findUiFacadeBoundaryViolations({ rootDirectory, rootFile: unsupportedFile }),
      [{ category: "boundary", capability: "unsupported-extension" }],
    );
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
    rmSync(outsideDirectory, { force: true, recursive: true });
  }
});

test("rejects callback fixture, alias, and control-flow mutations", () => {
  const mutations = [
    "async ({ authUi, page }) => {}",
    "async (fixtures) => {}",
    "async ({ authUi }) => { const page = authUi; }",
    "async ({ authUi }) => { return authUi; }",
  ];

  for (const callback of mutations) {
    assert.deepEqual(
      inspect(authSource(callback)),
      [{ category: "syntax", capability: "unapproved-callback" }],
    );
  }
});

test("rejects computed and unknown facade methods", () => {
  const callbacks = [
    'async ({ authUi }) => { await authUi["openLogin"](); }',
    "async ({ authUi }) => { await authUi.unknown(); }",
  ];

  for (const callback of callbacks) {
    assert.deepEqual(
      inspect(authSource(callback)),
      [{ category: "capability", capability: "unapproved-method" }],
    );
  }
});

test("rejects inline or reshaped submit credentials", () => {
  assert.deepEqual(
    inspect(authSource('async ({ authUi }) => { await authUi.submit({ email, password: "inline" }); }')),
    [{ category: "capability", capability: "unsafe-argument" }],
  );
});

test("rejects transport and dynamic execution in callbacks with one fixed syntax diagnostic", () => {
  const threats = [
    'fetch("/health");',
    'globalThis["fetch"]("/health");',
    'const key = "fetch"; globalThis[key]("/health");',
    "process.mainModule;",
    'require("node:http");',
    'import("node:http");',
    'eval("fetch(\'/health\')");',
    'Function("return fetch(\'/health\')")();',
    'new WebSocket("ws://127.0.0.1");',
  ];

  for (const threat of threats) {
    assert.deepEqual(
      inspect(authSource(`async ({ authUi }) => { ${threat} }`)),
      [{ category: "syntax", capability: "unapproved-callback" }],
    );
  }
});

test("rejects transport and dynamic execution at module scope with one fixed syntax diagnostic", () => {
  const threats = [
    'fetch("/health");',
    'globalThis["fetch"]("/health");',
    'const key = "fetch"; globalThis[key]("/health");',
    "process.mainModule;",
    'require("node:http");',
    'import("node:http");',
    'eval("fetch(\'/health\')");',
    'Function("return fetch(\'/health\')")();',
    'new WebSocket("ws://127.0.0.1");',
  ];

  for (const threat of threats) {
    assert.deepEqual(
      inspect(`import { authTest } from "../support/safe-ui-test.js"; ${threat}`),
      [{ category: "syntax", capability: "unapproved-top-level" }],
    );
  }
});

test("rejects parser-recovered incomplete source instead of widening the grammar", () => {
  assert.deepEqual(
    inspect(`
      import { authTest } from "../support/safe-ui-test.js";
      authTest("x", async ({ authUi }) => {
        await authUi.openLogin();
      }
    `),
    [{ category: "syntax", capability: "unapproved-top-level" }],
  );
});
