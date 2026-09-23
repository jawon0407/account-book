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
      name: "rejects facade apply and bind invocation with exact singleton findings",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects assignment destructuring of the facade with an exact singleton finding",
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
      name: "rejects page evaluation and script injection with exact singleton findings",
    },
  ],
  "root escape and unsupported extension": [
    {
      file: "./ui-facade-boundary.test.ts",
      name: "rejects invalid canonical path roles, symlink escapes, and non-lowercase extensions",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "authoritative preflight returns fixed findings for import mismatch and missing canonical files",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "authoritative preflight fails closed for replaced or linked safe UI support",
    },
    {
      file: "./ui-facade-boundary.test.ts",
      name: "authoritative preflight rejects executable support shadows beside the canonical TypeScript file",
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

/**
 * 임시 TS 파일에 합성 소스를 기록해 경계를 검사하고 임시 폴더를 정리한다.
 * @param source - 실행하지 않고 파싱할 테스트 소스다.
 * @returns 위반 목록. 파일 생성/삭제 부작용이 있으며 finally에서 정리한다.
 */
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

/**
 * callback 문법을 검사할 최소 인증 테스트 소스를 만든다.
 * @param callback - authTest 두 번째 인자에 넣을 소스 문자열이다.
 * @returns 합성 email/password 선언과 callback을 포함한 문자열. 실행하지 않는다.
 */
function authSource(callback: string): string {
  return `
    import { authTest } from "../support/safe-ui-test.js";
    const email = "verified@example.test";
    const password = "correct horse battery staple";
    authTest("x", ${callback});
  `;
}

/**
 * 최상위 문장 변형을 검사할 테스트 소스를 만든다.
 * @param statement - import 아래에 삽입할 소스 문자열이다.
 * @returns 최소 authTest 호출을 포함한 문자열. 실행하지 않는다.
 */
function moduleSource(statement: string): string {
  return `
    import { authTest } from "../support/safe-ui-test.js";
    ${statement}
    authTest("x", async ({ authUi }) => {});
  `;
}

/**
 * 파일 경계 검사기의 예상 밖 예외를 고정 표식으로 바꾼다.
 * @param options - 허용 rootDirectory와 검사 rootFile 경로다.
 * @returns 위반 목록 또는 unexpected-system-error. 원본 시스템 예외는 버린다.
 */
function inspectBoundary(options: Readonly<{ rootDirectory: string; rootFile: string }>): unknown {
  try {
    return findUiFacadeBoundaryViolations(options);
  } catch {
    return "unexpected-system-error";
  }
}

/**
 * 경로·실제 경로·파일 종류를 대조해 링크/대체 파일을 거부한다.
 * @param candidate - 현재 검사 경로다.
 * @param expected - 기대하는 정규 경로다.
 * @param kind - directory 또는 file이다.
 * @returns 동일한 일반 경로이면 true. 파일 조회 오류는 호출자에 전파한다.
 */
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

/**
 * 정규 지원 TS 옆에 우선 해석될 수 있는 실행 파일이 없는지 검사한다.
 * @param supportDirectory - safe-ui-test 지원 폴더다.
 * @returns js/jsx/tsx 대체물이 모두 없으면 true. 조회 실패도 false로 처리한다.
 */
function hasNoExecutableSupportShadows(supportDirectory: string): boolean {
  for (const fileName of ["safe-ui-test.js", "safe-ui-test.jsx", "safe-ui-test.tsx"] as const) {
    try {
      lstatSync(join(supportDirectory, fileName));
      return false;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
  }
  return true;
}

/**
 * 정규 파일 신원·지원 파일·첫 import를 확인한 뒤 AST 검사를 실행한다.
 * @param paths - UI/지원 디렉터리와 각 정규 파일 경로다.
 * @returns 위반 목록. 경로 오류는 고정 boundary 위반이며 소스를 실행하지 않는다.
 */
function inspectAuthoritativeAuthUiSpec(paths: CanonicalAuthUiPaths) {
  try {
    if (!hasExactOrdinaryIdentity(paths.uiDirectory, paths.uiDirectory, "directory")
      || !hasExactOrdinaryIdentity(paths.rootFile, paths.rootFile, "file")
      || !hasExactOrdinaryIdentity(paths.supportDirectory, paths.supportDirectory, "directory")
      || !hasExactOrdinaryIdentity(paths.supportFile, paths.supportFile, "file")
      || !hasNoExecutableSupportShadows(paths.supportDirectory)) {
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

/**
 * 격리된 UI/지원 파일 구조를 임시 디렉터리에 만든다.
 * @returns 정리할 parent 경로와 paths. 호출자가 테스트 후 폴더를 삭제해야 한다.
 */
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

/**
 * 소스를 AST로 읽어 test 호출의 문자열 제목을 모은다.
 * @param file - 검사할 테스트 파일 경로다.
 * @returns 이름 집합. 파일을 실행하지 않으며 읽기 오류는 전파한다.
 */
function collectNamedTests(file: string): ReadonlySet<string> {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  /**
   * AST를 재귀 순회해 직접 test 호출의 문자열 첫 인자를 기록한다.
   * @param node - 현재 AST 노드다.
   * @returns 반환값 없음. names 집합에 제목을 추가한다.
   */
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

test("accepts the real auth UI spec through the authoritative identity preflight", () => {
  assert.deepEqual(inspectAuthoritativeAuthUiSpec(actualAuthUiPaths), []);
});

test("authoritative preflight returns fixed findings for import mismatch and missing canonical files", () => {
  const mutations = [
    {
      /** import 불일치를 재현하도록 임시 UI 소스를 덮어쓴다.
       * @param fixture - 현재 테스트가 소유한 임시 정규 파일 구조다.
       * @returns 반환값 없음. rootFile 내용만 변경한다.
       */
      mutate(fixture: ReturnType<typeof createCanonicalAuthUiFixture>) {
        writeFileSync(
          fixture.paths.rootFile,
          'import { authTest } from "../support/not-safe-ui-test.js";',
        );
      },
      name: "import mismatch",
      want: [{ category: "import", capability: "unapproved-import" }],
    },
    {
      /** 정규 UI 파일 누락을 재현한다.
       * @param fixture - 현재 테스트의 임시 파일 구조다.
       * @returns 반환값 없음. 임시 rootFile만 삭제한다.
       */
      mutate(fixture: ReturnType<typeof createCanonicalAuthUiFixture>) {
        rmSync(fixture.paths.rootFile, { force: true });
      },
      name: "missing spec",
      want: [{ category: "boundary", capability: "boundary-escape" }],
    },
    {
      /** 정규 지원 파일 누락을 재현한다.
       * @param fixture - 현재 테스트의 임시 파일 구조다.
       * @returns 반환값 없음. 임시 supportFile만 삭제한다.
       */
      mutate(fixture: ReturnType<typeof createCanonicalAuthUiFixture>) {
        rmSync(fixture.paths.supportFile, { force: true });
      },
      name: "missing support",
      want: [{ category: "boundary", capability: "boundary-escape" }],
    },
  ] as const;

  for (const mutation of mutations) {
    const fixture = createCanonicalAuthUiFixture();
    try {
      mutation.mutate(fixture);
      assert.deepEqual(
        inspectAuthoritativeAuthUiSpec(fixture.paths),
        mutation.want,
        mutation.name,
      );
    } finally {
      rmSync(fixture.parent, { force: true, recursive: true });
    }
  }
});

test("authoritative preflight fails closed for replaced or linked safe UI support", () => {
  for (const mutation of ["replaced", "linked"] as const) {
    const fixture = createCanonicalAuthUiFixture();
    try {
      rmSync(fixture.paths.supportFile, { force: true });
      if (mutation === "replaced") {
        mkdirSync(fixture.paths.supportFile);
      } else {
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

test("authoritative preflight rejects executable support shadows beside the canonical TypeScript file", () => {
  for (const extension of [".js", ".jsx", ".tsx"] as const) {
    const fixture = createCanonicalAuthUiFixture();
    try {
      writeFileSync(
        join(fixture.paths.supportDirectory, `safe-ui-test${extension}`),
        "export const authTest = true;",
      );
      assert.deepEqual(
        inspectAuthoritativeAuthUiSpec(fixture.paths),
        [{ category: "boundary", capability: "boundary-escape" }],
        extension,
      );
    } finally {
      rmSync(fixture.parent, { force: true, recursive: true });
    }
  }
});

test("validates threat parity reference integrity without replacing semantic mutation tests", () => {
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

test("rejects facade apply and bind invocation with exact singleton findings", () => {
  for (const statement of [
    "await authUi.openLogin.apply(authUi, []);",
    "await authUi.openLogin.bind(authUi)();",
  ]) {
    assert.deepEqual(
      inspect(authSource(`async ({ authUi }) => { ${statement} }`)),
      [{ category: "capability", capability: "unapproved-method" }],
      statement,
    );
  }
});

test("rejects assignment destructuring of the facade with an exact singleton finding", () => {
  assert.deepEqual(
    inspect(authSource("async ({ authUi }) => { ({ openLogin } = authUi); }")),
    [{ category: "syntax", capability: "unapproved-callback" }],
  );
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

test("rejects page evaluation and script injection with exact singleton findings", () => {
  for (const statement of [
    'page.evaluate("fetch(\\"/health\\")");',
    'page.addInitScript("window.x = 1");',
    'page.addScriptTag({ content: "window.x = 1" });',
    'page.setContent("<main />");',
  ]) {
    assert.deepEqual(
      inspect(authSource(`async ({ authUi }) => { ${statement} }`)),
      [{ category: "syntax", capability: "unapproved-callback" }],
      statement,
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
