import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

function moduleSource(statement: string): string {
  return `
    import { authTest } from "../support/safe-ui-test.js";
    ${statement}
    authTest("x", async ({ authUi }) => {});
  `;
}

function inspectBoundary(options: Readonly<{ rootDirectory: string; rootFile: string }>): unknown {
  try {
    return findUiFacadeBoundaryViolations(options);
  } catch {
    return "unexpected-system-error";
  }
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
    'import { authTest } from "../support/safe-ui-test.js" assert { type: "json" };',
  ];

  for (const source of unapprovedImports) {
    assert.deepEqual(
      inspect(source),
      [{ category: "import", capability: "unapproved-import" }],
    );
  }
});

test("rejects every export AST form with the fixed import diagnostic", () => {
  const exports = [
    "export as namespace SafeUi;",
    'export const helper = "x";',
    "export function helper() {}",
    "export default function helper() {}",
    "export class Helper {}",
    "export interface Helper {}",
    "export type Helper = string;",
    "export enum Helper { Value }",
    "export namespace Helper {}",
  ];

  for (const statement of exports) {
    assert.deepEqual(
      inspect(moduleSource(statement)),
      [{ category: "import", capability: "unapproved-import" }],
      statement,
    );
  }
});

test("rejects invalid canonical path roles, symlink escapes, and non-lowercase extensions", () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "ui-facade-boundary-root-"));
  const outsideDirectory = mkdtempSync(join(tmpdir(), "ui-facade-boundary-outside-"));
  const outsideFile = join(outsideDirectory, "root.ts");
  const unsupportedFile = join(rootDirectory, "root.js");
  const uppercaseFile = join(rootDirectory, "root.TS");
  const directoryAsFile = join(rootDirectory, "directory.ts");
  const fileAsDirectory = join(rootDirectory, "file-as-directory.ts");
  const symlinkDirectory = join(rootDirectory, "escape");
  try {
    const allowed = 'import { authTest } from "../support/safe-ui-test.js";';
    writeFileSync(outsideFile, allowed);
    writeFileSync(unsupportedFile, allowed);
    writeFileSync(uppercaseFile, allowed);
    mkdirSync(directoryAsFile);
    writeFileSync(fileAsDirectory, allowed);
    symlinkSync(outsideDirectory, symlinkDirectory, "junction");

    const mutations = [
      {
        name: "outside root",
        options: { rootDirectory, rootFile: outsideFile },
        want: [{ category: "boundary", capability: "boundary-escape" }],
      },
      {
        name: "unsupported extension",
        options: { rootDirectory, rootFile: unsupportedFile },
        want: [{ category: "boundary", capability: "unsupported-extension" }],
      },
      {
        name: "uppercase extension",
        options: { rootDirectory, rootFile: uppercaseFile },
        want: [{ category: "boundary", capability: "unsupported-extension" }],
      },
      {
        name: "directory used as root file",
        options: { rootDirectory, rootFile: directoryAsFile },
        want: [{ category: "boundary", capability: "boundary-escape" }],
      },
      {
        name: "file used as root directory",
        options: { rootDirectory: fileAsDirectory, rootFile: fileAsDirectory },
        want: [{ category: "boundary", capability: "boundary-escape" }],
      },
      {
        name: "junction escapes root",
        options: { rootDirectory, rootFile: join(symlinkDirectory, "root.ts") },
        want: [{ category: "boundary", capability: "boundary-escape" }],
      },
      {
        name: "missing root file",
        options: { rootDirectory, rootFile: join(rootDirectory, "missing.ts") },
        want: [{ category: "boundary", capability: "boundary-escape" }],
      },
    ] as const;

    for (const mutation of mutations) {
      assert.deepEqual(inspectBoundary(mutation.options), mutation.want, mutation.name);
    }
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
    rmSync(outsideDirectory, { force: true, recursive: true });
  }
});

test("rejects non-literal, patterned, duplicate, and reserved top-level const bindings", () => {
  const declarations = [
    'const email: string = "x";',
    'const { email } = { email: "x" };',
    "const email = `x`;",
    'const email = "x"; const email = "y";',
    'const authTest = "shadow";',
  ];

  for (const declaration of declarations) {
    assert.deepEqual(
      inspect(moduleSource(declaration)),
      [{ category: "syntax", capability: "unapproved-top-level" }],
      declaration,
    );
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

test("rejects renamed, rest, defaulted, and typed callback bindings", () => {
  const callbacks = [
    "async ({ authUi: facade }) => {}",
    "async ({ ...authUi }) => {}",
    "async ({ authUi = undefined }) => {}",
    "async ({ authUi }: { authUi: unknown }) => {}",
    "async ({ authUi } = { authUi: undefined }) => {}",
  ];

  for (const callback of callbacks) {
    assert.deepEqual(
      inspect(authSource(callback)),
      [{ category: "syntax", capability: "unapproved-callback" }],
      callback,
    );
  }
});

test("rejects invalid authTest title, arity, and non-async callbacks", () => {
  const calls = [
    'authTest(email, async ({ authUi }) => {});',
    'authTest("x");',
    'authTest("x", async ({ authUi }) => {}, "extra");',
    'authTest("x", ({ authUi }) => {});',
    'authTest("x", function ({ authUi }) {});',
  ];

  for (const call of calls) {
    assert.deepEqual(
      inspect(`
        import { authTest } from "../support/safe-ui-test.js";
        const email = "verified@example.test";
        ${call}
      `),
      [{ category: "syntax", capability: "unapproved-callback" }],
      call,
    );
  }
});

test("rejects parenthesized, optional, sequence, tagged, and indirect authTest calls", () => {
  const calls = [
    '(authTest)("x", async ({ authUi }) => {});',
    'authTest?.("x", async ({ authUi }) => {});',
    '(0, authTest)("x", async ({ authUi }) => {});',
    "authTest`x`;",
    'authTest.call(undefined, "x", async ({ authUi }) => {});',
    'void authTest("x", async ({ authUi }) => {});',
  ];

  for (const call of calls) {
    assert.deepEqual(
      inspect(`
        import { authTest } from "../support/safe-ui-test.js";
        ${call}
      `),
      [{ category: "syntax", capability: "unapproved-top-level" }],
      call,
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

test("rejects non-direct awaited facade call shapes with exact singleton findings", () => {
  const calls = [
    {
      statement: "await (authUi.openLogin)();",
      want: [{ category: "capability", capability: "unapproved-method" }],
    },
    {
      statement: "await authUi?.openLogin();",
      want: [{ category: "capability", capability: "unapproved-method" }],
    },
    {
      statement: "await (0, authUi.openLogin)();",
      want: [{ category: "capability", capability: "unapproved-method" }],
    },
    {
      statement: "await authUi.openLogin.call(authUi);",
      want: [{ category: "capability", capability: "unapproved-method" }],
    },
    {
      statement: "await authUi.openLogin?.();",
      want: [{ category: "syntax", capability: "unapproved-callback" }],
    },
    {
      statement: "await authUi.openLogin`x`;",
      want: [{ category: "syntax", capability: "unapproved-callback" }],
    },
  ] as const;

  for (const call of calls) {
    assert.deepEqual(
      inspect(authSource(`async ({ authUi }) => { ${call.statement} }`)),
      call.want,
      call.statement,
    );
  }
});

test("rejects arguments passed to zero-argument facade methods", () => {
  assert.deepEqual(
    inspect(authSource('async ({ authUi }) => { await authUi.openLogin("x"); }')),
    [{ category: "capability", capability: "unsafe-argument" }],
  );
});

test("rejects every reshaped or unresolved submit credential object", () => {
  const callbacks = [
    'async ({ authUi }) => { await authUi.submit({ email, password: "inline" }); }',
    "async ({ authUi }) => { await authUi.submit({ password, email }); }",
    "async ({ authUi }) => { await authUi.submit({ email, email }); }",
    'async ({ authUi }) => { await authUi.submit({ ["email"]: email, password }); }',
    "async ({ authUi }) => { await authUi.submit({ ...{ email, password } }); }",
    "async ({ authUi }) => { await authUi.submit({ email: email, password }); }",
  ];

  for (const callback of callbacks) {
    assert.deepEqual(
      inspect(authSource(callback)),
      [{ category: "capability", capability: "unsafe-argument" }],
      callback,
    );
  }

  assert.deepEqual(
    inspect(`
      import { authTest } from "../support/safe-ui-test.js";
      const email = "verified@example.test";
      authTest("x", async ({ authUi }) => {
        await authUi.submit({ email, password });
      });
    `),
    [{ category: "capability", capability: "unsafe-argument" }],
    "undeclared shorthand",
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
