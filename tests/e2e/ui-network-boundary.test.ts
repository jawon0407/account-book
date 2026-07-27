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
        void [expect, AxeBuilder];
        void (null as unknown as Page);
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
    inspect({
      "root.ts": `
        import { test, request as expect } from "@playwright/test";
        expect.newContext();
      `,
    }),
    [{ category: "import", capability: "unapproved-playwright-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import { AxeBuilder as Builder } from "@axe-core/playwright"; void Builder;' }),
    [{ category: "import", capability: "unapproved-external-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import type { Page } from "@playwright/test"; void (null as unknown as Page);' }),
    [{ category: "import", capability: "unapproved-playwright-import" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'import type { AxeBuilder } from "@axe-core/playwright"; void (null as unknown as AxeBuilder);' }),
    [{ category: "import", capability: "unapproved-external-import" }],
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

test("mutation: page.waitForRequest is outside the closed Page allowlist", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'await page.waitForRequest("**/api");' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: page.route is outside the closed Page allowlist", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'await page.route("**/api", async (route) => { await route.continue(); });' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: route.fetch is outside the closed Route allowlist", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'await route.fetch();' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: page.waitForResponse cannot be retained as a declaration alias", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'const wait = page.waitForResponse; await wait("**/api");' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: page.request cannot be retained as a declaration alias", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'const client = page.request; await client.get("/api");' }),
    [{ category: "network", capability: "direct-http-client" }],
  );
});

test("mutation: fetch cannot be retained as a declaration alias", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'const f = fetch; await f("/api");' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: global fetch and XMLHttpRequest members cannot be retained as aliases", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'const f = window.fetch; await f("/api");' }),
    [{ category: "network", capability: "direct-http-client" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "const Xhr = window.XMLHttpRequest; new Xhr();" }),
    [{ category: "network", capability: "direct-http-client" }],
  );
});

test("mutation: browser Request and Response factories are outside the closed allowlist", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'new Request("/api"); new Response("{}");' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: Page and Context cannot be retained as simple assignment aliases", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'let client; client = page; let browser; browser = context;' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: sensitive capabilities cannot be retained through destructuring", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'const { waitForRequest } = page; const { request: client } = context;' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: sensitive capabilities cannot be returned or passed to untrusted consumers", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'consume(page); function leak() { return context; }' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: exact expect and AxeBuilder consumers cannot be shadowed", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        test("shadow", async ({ page }) => {
          (function run(expect) { expect(page); })(consume);
          (function audit(AxeBuilder) { new AxeBuilder({ page }); })(consume);
        });
      `,
    }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: trusted test, expect, and AxeBuilder bindings cannot come from local aliases", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        import { test } from "@playwright/test";
        import { expect, AxeBuilder } from "./helper.js";
        test("local consumers", async ({ page }) => {
          expect(page);
          new AxeBuilder({ page });
        });
      `,
      "helper.ts": `
        export function expect(value: unknown): void { void value; }
        export class AxeBuilder { constructor(value: unknown) { void value; } }
      `,
    }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({
      "root.ts": `
        import { customTest as test } from "./helper.js";
        test("local test alias", async ({ page }) => { await page.waitForURL("**/app"); });
      `,
      "helper.ts": `
        import { test } from "@playwright/test";
        export const customTest = test;
      `,
    }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: Page methods cannot be invoked through call, apply, or bind", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        await page.goto.call(page, "/");
        await page.reload.apply(page);
        const navigate = page.goBack.bind(page);
        await navigate();
      `,
    }),
    [{ category: "navigation", capability: "navigation-response" }],
  );
});

test("mutation: optional and computed Page members fail closed", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        await page?.waitForURL("**/app");
        await page["waitForRequest"]("**/api");
        await page[method]("**/api");
      `,
    }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: BrowserContext, Request, Route, and APIRequest types fail closed", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        declare const browser: BrowserContext;
        declare const captured: Request;
        declare const route: Route;
        declare const api: APIRequestContext;
        void [browser, captured, route, api];
      `,
    }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: only exact page and context Playwright fixture bindings are allowed", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'test("browser fixture", async ({ browser }) => { await browser.newPage(); });' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'test("aliased page fixture", async ({ page: client }) => { await client.waitForRequest("**/api"); });' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'test("whole fixture object", async (fixtures) => { await fixtures.page.waitForRequest("**/api"); });' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: Page, Context, Request, Route, and APIRequest factories fail closed", () => {
  assert.deepEqual(
    inspect({ "root.ts": "declare function getPage(): Page;" }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare function getContext(): BrowserContext;" }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare function getRequest(): Request;" }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare function getRoute(): Route;" }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": "declare function getApiRequest(): APIRequestContext;" }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
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

test("mutation: function evaluation receives the full UI network policy visitor", () => {
  assert.deepEqual(
    inspect({ "root.ts": "page.evaluate(() => new XMLHttpRequest());" }),
    [{ category: "network", capability: "direct-http-client" }],
  );
});

test("mutation: only Page itself may evaluate a function", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'page.locator("main").evaluate(() => document.body.clientWidth);' }),
    [{ category: "execution", capability: "dynamic-code" }],
  );
});

test("mutation: Locator network, route, and request members are outside the closed allowlist", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const item = page.locator("main");
        item.request();
        item.route();
        page.locator("main").request();
      `,
    }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
});

test("mutation: Locator values cannot be passed, returned, or dynamically invoked", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'consume(page.locator("main"));' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'function leak() { return page.locator("main"); }' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'page.locator("main")[method]();' }),
    [{ category: "network", capability: "unapproved-browser-capability" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'page.locator("main").evaluateAll(() => []);' }),
    [{ category: "execution", capability: "dynamic-code" }],
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
    inspect({ "root.ts": 'const { goto } = page; const response = await goto("/"); response.status();' }),
    [{ category: "navigation", capability: "navigation-response" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'const first = page.goto; const second = first; await second("/");' }),
    [{ category: "navigation", capability: "navigation-response" }],
  );
  assert.deepEqual(
    inspect({ "root.ts": 'await page.goto("/"); await page.reload(); await page.goBack(); await page.goForward();' }),
    [],
  );
});

test("mutation: assignment-destructured navigation aliases cannot retain navigation results", () => {
  assert.deepEqual(
    inspect({ "root.ts": 'let goto; ({ goto } = page); const relay = goto; const response = await relay("/"); response.status();' }),
    [{ category: "navigation", capability: "navigation-response" }],
  );
});

test("guard: exact authorization recorder and DOM-only function evaluation remain permitted", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
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
  assert.deepEqual(
    inspect({
      "root.ts": 'context.on("request", function authorizationRecorder(request) { return request.headerValue("authorization") === null; });',
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: authorization recorder rejects direct raw header comparisons", () => {
  assert.deepEqual(
    inspect({
      "root.ts": 'page.on("request", function authorizationRecorder(request) { return request.headerValue("authorization") === "Bearer test"; });',
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: authorization recorder rejects a raw promise callback return", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => value));
        });
      `,
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test('mutation: authorization recorder rejects value + "" retention', () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => value + ""));
        });
      `,
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: authorization recorder rejects object wrapping", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => ({ value })));
        });
      `,
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: authorization recorder rejects storing the raw value", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        let retained;
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => retained = value));
        });
      `,
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: authorization promise callback accepts only strict null comparisons", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => null === value));
        });
      `,
    }),
    [],
  );
  assert.deepEqual(
    inspect({
      "root.ts": `
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", function authorizationRecorder(request) {
          authorizationPresence.push(request.headerValue("authorization").then((value) => value != null));
        });
      `,
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("mutation: authorization recorder rejects async and annotated callback variants", () => {
  assert.deepEqual(
    inspect({
      "root.ts": `
        const authorizationPresence: Array<Promise<boolean>> = [];
        page.on("request", async function authorizationRecorder(request: unknown): Promise<void> {
          authorizationPresence.push(request.headerValue("authorization").then(async (value: unknown) => value !== null));
        });
      `,
    }),
    [{ category: "event", capability: "unapproved-request-observer" }],
  );
});

test("guard: the dedicated UI root has no response-observation boundary violations", () => {
  const rootDirectory = fileURLToPath(new URL("./ui", import.meta.url));
  assert.deepEqual(
    findUiNetworkBoundaryViolations({ rootDirectory, rootFile: fileURLToPath(new URL("./ui/auth-ui.spec.ts", import.meta.url)) }),
    [],
  );
});
