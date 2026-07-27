import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { findUiNetworkBoundaryViolations } from "./ui-network-boundary.js";

type FileGraph = Readonly<{
  directory: string;
  rootFile: string;
}>;

/**
 * Creates a disposable UI import graph whose parent is always removed by the caller.
 * @param files - Relative source files and their TypeScript contents.
 * @returns The UI root directory and root spec path.
 */
function createGraph(files: Readonly<Record<string, string>>): FileGraph {
  const directory = mkdtempSync(join(tmpdir(), "ui-network-boundary-"));
  for (const [file, source] of Object.entries(files)) {
    const filePath = join(directory, file);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source, "utf8");
  }
  return { directory, rootFile: join(directory, "root.ts") };
}

/**
 * Inspects one fresh graph and removes its complete temporary parent in all outcomes.
 * @param files - Relative source files and their TypeScript contents.
 * @returns Stable category/capability policy findings.
 */
function inspect(files: Readonly<Record<string, string>>) {
  const graph = createGraph(files);
  try {
    return findUiNetworkBoundaryViolations({ rootDirectory: graph.directory, rootFile: graph.rootFile });
  } finally {
    rmSync(graph.directory, { recursive: true, force: true });
  }
}

test("mutation: only exact approved UI imports and static local modules are permitted", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        import { test, expect, type Page } from "@playwright/test";
        import { AxeBuilder } from "@axe-core/playwright";
        export { helper } from "./helper.js";
        void [test, expect, AxeBuilder];
        type CurrentPage = Page;
        void (null as unknown as CurrentPage);
      `,
      "helper.ts": "export const helper = true;",
    }),
    [],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import playwright from "@playwright/test";' }),
    [{ category: "import", capability: "unapproved-playwright-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import { request } from "@playwright/test";' }),
    [{ category: "import", capability: "unapproved-playwright-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import ky from "ky";' }),
    [{ category: "import", capability: "unapproved-external-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'await import("./helper.js");' }),
    [{ category: "import", capability: "dynamic-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'require("./helper.js");' }),
    [{ category: "import", capability: "dynamic-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import "./missing.js";' }),
    [{ category: "boundary", capability: "boundary-escape" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import "./helper.css";', "helper.css": "" }),
    [{ category: "boundary", capability: "unsupported-extension" }],
  );
});

test("mutation: root and local helpers cannot escape through paths or reparse points", () => {
  const graph = createGraph({ "root.ts": 'import "./escape/helper.js";' });
  const outside = mkdtempSync(join(tmpdir(), "ui-network-boundary-outside-"));
  try {
    writeFileSync(join(outside, "helper.ts"), "export const outside = true;", "utf8");
    symlinkSync(outside, join(graph.directory, "escape"), "junction");
    assert.deepEqual(
      findUiNetworkBoundaryViolations({ rootDirectory: graph.directory, rootFile: graph.rootFile }),
      [{ category: "boundary", capability: "boundary-escape" }],
    );
    assert.deepEqual(
      findUiNetworkBoundaryViolations({ rootDirectory: graph.directory, rootFile: join(outside, "helper.ts") }),
      [{ category: "boundary", capability: "boundary-escape" }],
    );
  } finally {
    rmSync(graph.directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("mutation: direct browser, Playwright, and request response transport cannot enter UI ownership", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        fetch("/api");
        new XMLHttpRequest();
        page.request.get("/api");
        context.request.post("/api");
        request.response();
      `,
    }),
    [
      { category: "network", capability: "direct-http-client" },
      { category: "network", capability: "request-context" },
      { category: "response", capability: "request-response" },
    ],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'page.request.get("/api");' }),
    [{ category: "network", capability: "direct-http-client" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'context.request.get("/api");' }),
    [{ category: "network", capability: "request-context" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "new XMLHttpRequest();" }),
    [{ category: "network", capability: "direct-http-client" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "request.response();" }),
    [{ category: "response", capability: "request-response" }],
  );
});

test("mutation: response types, body/status access, aliases, destructuring, and imported helpers are rejected", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        import { consume } from "./helper.js";
        type OnlyText = Pick<Response, "text">;
        type Alias = Response;
        declare const response: Alias;
        const { text } = response;
        ({ status: ignored } = response);
        function read({ json }: Response): void { void json; }
        response?.["text"]?.();
        response?.[key]?.();
        consume(response);
        void (null as unknown as OnlyText);
      `,
      "helper.ts": "export function consume(response: Response): void { response.json(); }",
    }),
    [
      { category: "response", capability: "response-consumption" },
      { category: "response", capability: "response-type" },
    ],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare const response: Response; response.status;" }),
    [
      { category: "response", capability: "http-status" },
      { category: "response", capability: "response-type" },
    ],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare const response: Response; ({ text } = response);" }),
    [
      { category: "response", capability: "response-consumption" },
      { category: "response", capability: "response-type" },
    ],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare const response: Response; response[key];" }),
    [
      { category: "response", capability: "response-consumption" },
      { category: "response", capability: "response-type" },
    ],
  );
});

test("mutation: response observers and dynamic event names are fail-closed", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        page.waitForEvent("response");
        page.on("response", () => {});
        page.once("request", () => {});
        page.addListener("request", () => {});
        page.prependListener("response", () => {});
        page.prependOnceListener("response", () => {});
        page.on(eventName, () => {});
      `,
    }),
    [
      { category: "event", capability: "response-event" },
      { category: "event", capability: "unapproved-request-observer" },
      { category: "response", capability: "response-event" },
    ],
  );
});

test("mutation: evaluation and script or HTML injection forms are rejected", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        page.evaluate("fetch('/api')");
        page.evaluate(() => fetch("/api"));
        page.evaluateHandle(() => 1);
        page.waitForFunction(() => true);
        page.addInitScript("window.x = 1");
        page.addScriptTag({ content: "" });
        page.setContent("<main />");
        eval("1");
        Function("return 1");
      `,
    }),
    [
      { category: "execution", capability: "dynamic-code" },
      { category: "execution", capability: "script-injection" },
      { category: "network", capability: "direct-http-client" },
    ],
  );
});

test("mutation: only directly awaited discarded navigation results are permitted", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const response = await page.goto("/");
        return page.reload();
        consume(page.goBack());
        (await page.goForward())?.status();
        const navigate = page.goto;
        await navigate("/");
      `,
    }),
    [{ category: "navigation", capability: "navigation-response" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'await page.goto("/"); await page.reload(); await page.goBack(); await page.goForward();' }),
    [],
  );
});

test("guard: exact authorization recorder and DOM-only function evaluation remain permitted", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        page.on("request", function authorizationRecorder(request) {
          return request.headerValue("authorization") === "Bearer test";
        });
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => value !== null));
        });
        await page.evaluate(() => [document.body.clientWidth, localStorage.length]);
      `,
    }),
    [],
  );
  assert.deepEqual(
    inspect({
      "root.ts": 'page.on("request", function authorizationRecorder(request) { return request.headerValue("authorization"); });',
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: the current UI spec reports only the accepted legacy boundary findings", () => {
  const rootDirectory = fileURLToPath(new URL(".", import.meta.url));
  assert.deepEqual(
    findUiNetworkBoundaryViolations({ rootDirectory, rootFile: fileURLToPath(new URL("./auth-ui.spec.ts", import.meta.url)) }),
    [
      { category: "event", capability: "unapproved-request-observer" },
      { category: "network", capability: "direct-http-client" },
      { category: "response", capability: "response-event" },
    ],
  );
});
