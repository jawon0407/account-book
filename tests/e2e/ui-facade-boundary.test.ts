import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as ts from "typescript";
import { findUiFacadeBoundaryViolations } from "./ui-facade-boundary.js";

const exactAuthTestImport = 'import { authTest } from "../support/safe-ui-test.js";';

type CanonicalAuthUiPaths = Readonly<{
  uiDirectory: string;
  rootFile: string;
  supportDirectory: string;
  supportFile: string;
}>;

const actualAuthUiPaths: CanonicalAuthUiPaths = Object.freeze({
  uiDirectory: fileURLToPath(new URL("./ui", import.meta.url)),
  rootFile: fileURLToPath(new URL("./ui/auth-ui.spec.ts", import.meta.url)),
  supportDirectory: fileURLToPath(new URL("./support", import.meta.url)),
  supportFile: fileURLToPath(new URL("./support/safe-ui-test.ts", import.meta.url)),
});

type ThreatTestReference = Readonly<{
  file: string;
  name: string;
}>;

const threatParity = {
  "external/default/namespace/aliased/local/dynamic import": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects raw Playwright and import-shape mutations with a fixed diagnostic",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects transport and dynamic execution at module scope with one fixed syntax diagnostic",
    },
  ],
  "fetch/XHR/Request/Response/WebSocket/EventSource": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects transport and dynamic execution in callbacks with one fixed syntax diagnostic",
    },
    {
      file: "./support/transport-tripwire.test.ts",
      name: "blocks every configured transport and restores exact descriptors",
    },
  ],
  "Page/Context/Request/Route/APIRequestContext/Locator access": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects raw Playwright and import-shape mutations with a fixed diagnostic",
    },
    {
      file: "./support/safe-ui-test.test.ts",
      name: "exposes only one frozen authUi fixture",
    },
    {
      file: "./support/safe-ui-test.test.ts",
      name: "constructs one frozen null-prototype facade and registers one request listener",
    },
  ],
  "response consumption/status/navigation response": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects computed and unknown facade methods",
    },
    {
      file: "./support/safe-ui-test.test.ts",
      name: "runs login and submit operations without returning raw capability data",
    },
  ],
  "event observers and Authorization raw retention": [
    {
      file: "./support/safe-ui-test.test.ts",
      name: "constructs one frozen null-prototype facade and registers one request listener",
    },
    {
      file: "./support/safe-ui-test.test.ts",
      name: "stores request authorization presence only as booleans",
    },
    {
      file: "./support/safe-ui-test.test.ts",
      name: "projects a rejected authorization lookup immediately to fail-closed true",
    },
  ],
  "alias/declaration-assignment destructuring/call-apply-bind/computed access": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects callback fixture, alias, and control-flow mutations",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects non-literal, patterned, duplicate, and reserved top-level const bindings",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects non-direct awaited facade call shapes with exact singleton findings",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects computed and unknown facade methods",
    },
  ],
  "eval/Function/script injection": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects transport and dynamic execution in callbacks with one fixed syntax diagnostic",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects transport and dynamic execution at module scope with one fixed syntax diagnostic",
    },
  ],
  "root escape and unsupported extension": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects invalid canonical path roles, symlink escapes, and non-lowercase extensions",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "authoritative preflight fails closed for missing, replaced, or linked safe UI support",
    },
  ],
} as const satisfies Readonly<Record<string, readonly ThreatTestReference[]>>;

const exactThreatFamilies = [
  "external/default/namespace/aliased/local/dynamic import",
  "fetch/XHR/Request/Response/WebSocket/EventSource",
  "Page/Context/Request/Route/APIRequestContext/Locator access",
  "response consumption/status/navigation response",
  "event observers and Authorization raw retention",
  "alias/declaration-assignment destructuring/call-apply-bind/computed access",
  "eval/Function/script injection",
  "root escape and unsupported extension",
] as const;

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

function hasExactOrdinaryIdentity(
  candidate: string,
  expected: string,
  kind: "directory" | "file",
): boolean {
  const expectedPath = resolve(expected);
  if (resolve(candidate) !== expectedPath) return false;
  const linkStatus = lstatSync(candidate);
  const targetStatus = statSync(candidate);
  const hasExpectedKind = kind === "directory"
    ? linkStatus.isDirectory() && targetStatus.isDirectory()
    : linkStatus.isFile() && targetStatus.isFile();
  return !linkStatus.isSymbolicLink()
    && hasExpectedKind
    && realpathSync.native(candidate) === expectedPath;
}

function inspectAuthoritativeAuthUiSpec(paths: CanonicalAuthUiPaths) {
  try {
    if (!hasExactOrdinaryIdentity(paths.uiDirectory, paths.uiDirectory, "directory")
      || !hasExactOrdinaryIdentity(paths.rootFile, paths.rootFile, "file")
      || !hasExactOrdinaryIdentity(paths.supportDirectory, paths.supportDirectory, "directory")
      || !hasExactOrdinaryIdentity(paths.supportFile, paths.supportFile, "file")) {
      return [{ category: "boundary", capability: "boundary-escape" }] as const;
    }
    const uiRealPath = realpathSync.native(paths.uiDirectory);
    const rootRealPath = realpathSync.native(paths.rootFile);
    const supportRealPath = realpathSync.native(paths.supportDirectory);
    const supportFileRealPath = realpathSync.native(paths.supportFile);
    if (dirname(rootRealPath) !== uiRealPath
      || basename(rootRealPath) !== "auth-ui.spec.ts"
      || dirname(supportFileRealPath) !== supportRealPath
      || basename(supportFileRealPath) !== "safe-ui-test.ts") {
      return [{ category: "boundary", capability: "boundary-escape" }] as const;
    }
    if (readFileSync(rootRealPath, "utf8").split(/\r?\n/u)[0] !== exactAuthTestImport) {
      return [{ category: "import", capability: "unapproved-import" }] as const;
    }
    return findUiFacadeBoundaryViolations({
      rootDirectory: uiRealPath,
      rootFile: rootRealPath,
    });
  } catch {
    return [{ category: "boundary", capability: "boundary-escape" }] as const;
  }
}

function createCanonicalAuthUiFixture(): Readonly<{
  parent: string;
  paths: CanonicalAuthUiPaths;
}> {
  const parent = mkdtempSync(join(tmpdir(), "ui-facade-identity-"));
  const uiDirectory = join(parent, "ui");
  const supportDirectory = join(parent, "support");
  const rootFile = join(uiDirectory, "auth-ui.spec.ts");
  const supportFile = join(supportDirectory, "safe-ui-test.ts");
  mkdirSync(uiDirectory);
  mkdirSync(supportDirectory);
  writeFileSync(rootFile, `${exactAuthTestImport}
    authTest("x", async ({ authUi }) => { await authUi.openLogin(); });
  `);
  writeFileSync(supportFile, "export const authTest = true;");
  return { parent, paths: { uiDirectory, rootFile, supportDirectory, supportFile } };
}

function collectNamedTests(file: string): ReadonlySet<string> {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const [firstArgument] = ts.isCallExpression(node) ? node.arguments : [];
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === "test"
      && firstArgument !== undefined
      && ts.isStringLiteral(firstArgument)) {
      names.add(firstArgument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

test("accepts the real auth UI spec with its exact authTest import", () => {
  assert.equal(readFileSync(actualAuthUiPaths.rootFile, "utf8").split(/\r?\n/u)[0], exactAuthTestImport);
  assert.deepEqual(inspectAuthoritativeAuthUiSpec(actualAuthUiPaths), []);
});

test("authoritative preflight fails closed for missing, replaced, or linked safe UI support", () => {
  for (const mutation of ["missing", "replaced", "linked"] as const) {
    const fixture = createCanonicalAuthUiFixture();
    try {
      rmSync(fixture.paths.supportFile, { force: true });
      if (mutation === "replaced") {
        mkdirSync(fixture.paths.supportFile);
      } else if (mutation === "linked") {
        const outsideDirectory = join(fixture.parent, "outside-support");
        mkdirSync(outsideDirectory);
        writeFileSync(join(outsideDirectory, "safe-ui-test.ts"), "export const authTest = true;");
        rmSync(fixture.paths.supportDirectory, { force: true, recursive: true });
        symlinkSync(outsideDirectory, fixture.paths.supportDirectory, "junction");
      }
      assert.deepEqual(
        inspectAuthoritativeAuthUiSpec(fixture.paths),
        [{ category: "boundary", capability: "boundary-escape" }],
        mutation,
      );
    } finally {
      rmSync(fixture.parent, { force: true, recursive: true });
    }
  }
});

test("maps every retired analyzer threat family to exact surviving Gate, runtime, or support tests", () => {
  assert.deepEqual(Object.keys(threatParity), [...exactThreatFamilies]);
  const testsByFile = new Map<string, ReadonlySet<string>>();
  for (const family of exactThreatFamilies) {
    const references = threatParity[family];
    assert.ok(references.length > 0, `${family} must retain a named security test`);
    for (const reference of references) {
      const file = fileURLToPath(new URL(reference.file, import.meta.url));
      let names = testsByFile.get(file);
      if (names === undefined) {
        names = collectNamedTests(file);
        testsByFile.set(file, names);
      }
      assert.equal(
        names.has(reference.name),
        true,
        `${family} must resolve ${reference.file}#${reference.name}`,
      );
    }
  }
});

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

test("allows only the exact failed-password template from the top-level password constant", () => {
  assert.deepEqual(
    inspect(authSource(`
      async ({ authUi }) => {
        await authUi.submit({ email, password: \`\${password}!wrong\` });
      }
    `)),
    [],
  );
});

test("rejects arbitrary, tagged, and extended failed-password templates", () => {
  const callbacks = [
    "async ({ authUi }) => { await authUi.submit({ email, password: `${email}!wrong` }); }",
    "async ({ authUi }) => { await authUi.submit({ email, password: `${password}!WRONG` }); }",
    "async ({ authUi }) => { await authUi.submit({ email, password: `${password}!wrong${email}` }); }",
    "async ({ authUi }) => { await authUi.submit({ email, password: tag`${password}!wrong` }); }",
  ];

  for (const callback of callbacks) {
    assert.deepEqual(
      inspect(authSource(callback)),
      [{ category: "capability", capability: "unsafe-argument" }],
      callback,
    );
  }
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

test("rejects a callback property rename when the local binding remains authUi", () => {
  assert.deepEqual(
    inspect(authSource("async ({ authUi: authUi }) => {}")),
    [{ category: "syntax", capability: "unapproved-callback" }],
  );
});

test("rejects a callback local binding rename without a property mapping", () => {
  assert.deepEqual(
    inspect(authSource("async ({ facade }) => {}")),
    [{ category: "syntax", capability: "unapproved-callback" }],
  );
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
