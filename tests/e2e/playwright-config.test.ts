import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  findResponseBodyUses,
  findResponseBodyUsesInProgram,
} from "./response-body-ownership.js";

/**
 * Wraps one DOM Response mutation in a minimal semantic fixture.
 * @param expression - Body/status expression exercised by the policy test.
 * @returns In-memory TypeScript source containing no transport values.
 */
function responseFixture(expression: string): string {
  return `declare const response: Response;\n${expression};`;
}

/**
 * Wraps one Playwright response mutation with exact package type provenance.
 * @param type - Public Playwright response type under test.
 * @param expression - Body/status expression exercised by the policy test.
 * @returns In-memory TypeScript source containing no transport values.
 */
function playwrightResponseFixture(type: "APIResponse" | "Response", expression: string): string {
  return `
    import type { ${type} as PlaywrightResponse } from "@playwright/test";
    declare const response: PlaywrightResponse;
    ${expression};
  `;
}

/**
 * Resolves a committed mutation fixture without exposing its source in assertion output.
 * @param name - Fixed fixture file name under the response-ownership fixture directory.
 * @returns Absolute fixture path for the TypeScript Program root.
 */
function ownershipFixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/response-body-ownership/${name}`, import.meta.url));
}

test("mutation: project routing, serial execution, or trace-off policy cannot drift", async () => {
  process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
  process.env.TEST_DATABASE_DISPOSABLE = "true";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { default: config } = await import("./playwright.config.js");
  const projects = new Map((config.projects ?? []).map((project) => [project.name, project]));

  assert.deepEqual([...projects.keys()].sort(), ["http-contract", "ui-desktop-1440x900", "ui-mobile-390x844"]);
  assert.equal(projects.get("ui-mobile-390x844")?.testMatch, "auth-ui.spec.ts");
  assert.equal(projects.get("ui-desktop-1440x900")?.testMatch, "auth-ui.spec.ts");
  assert.equal(projects.get("http-contract")?.testMatch, "auth-response.spec.ts");
  assert.equal(config.fullyParallel, false);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.use?.trace, "off");
});

test("mutation: DOM body reads through dot, bracket, optional, or computed access are rejected", () => {
  const forbiddenMethods = ["json", "text", "arrayBuffer", "blob", "bytes", "formData"] as const;

  for (const method of forbiddenMethods) {
    assert.deepEqual(findResponseBodyUses(responseFixture(`response.${method}()`)), [{ category: "consumption", method }]);
    assert.deepEqual(findResponseBodyUses(responseFixture(`response["${method}"]()`)), [{ category: "consumption", method }]);
  }
  assert.deepEqual(
    findResponseBodyUses(responseFixture("response?.json?.()")),
    [{ category: "consumption", method: "json" }],
  );
  assert.deepEqual(findResponseBodyUses(responseFixture("response.body?.getReader()")), [{ category: "stream", method: "body" }]);
  assert.deepEqual(findResponseBodyUses(responseFixture('response["body"]?.getReader()')), [{ category: "stream", method: "body" }]);
  assert.deepEqual(findResponseBodyUses(responseFixture('response["body"]()')), [{ category: "stream", method: "body" }]);
  assert.deepEqual(
    findResponseBodyUses(responseFixture('const method = "json" as const;\nresponse[method]()')),
    [{ category: "consumption", method: "json" }],
  );
  assert.deepEqual(
    findResponseBodyUses(responseFixture("declare const method: string;\nresponse[method]()")),
    [{ category: "consumption", method: "computed" }],
  );
  assert.deepEqual(
    findResponseBodyUses(responseFixture("declare const property: string;\nresponse[property]")),
    [{ category: "stream", method: "computed" }],
  );
});

test("mutation: Playwright Response and APIResponse body methods cannot move into UI ownership", () => {
  for (const type of ["Response", "APIResponse"] as const) {
    assert.deepEqual(
      findResponseBodyUses(playwrightResponseFixture(type, "response.json()")),
      [{ category: "consumption", method: "json" }],
    );
    assert.deepEqual(
      findResponseBodyUses(playwrightResponseFixture(type, 'response?.["text"]?.()')),
      [{ category: "consumption", method: "text" }],
    );
    assert.deepEqual(
      findResponseBodyUses(playwrightResponseFixture(type, "response.body?.()")),
      [{ category: "consumption", method: "body" }],
    );
    assert.deepEqual(findResponseBodyUses(playwrightResponseFixture(type, "response.status()")), []);
  }
  assert.deepEqual(
    findResponseBodyUses(playwrightResponseFixture("Response", "declare const method: string;\nresponse?.[method]?.()")),
    [{ category: "consumption", method: "computed" }],
  );
  assert.deepEqual(
    findResponseBodyUses(playwrightResponseFixture(
      "Response",
      "type Wrapped = PlaywrightResponse & { readonly fixture: true };\n"
        + "declare const wrapped: Wrapped;\n"
        + "const alias = wrapped;\n"
        + "alias?.text?.()",
    )),
    [{ category: "consumption", method: "text" }],
  );
});

test("mutation guard: status-only DOM Response access remains permitted", () => {
  assert.deepEqual(findResponseBodyUses(responseFixture('const property = "status" as const;\nresponse[property]')), []);
  assert.deepEqual(findResponseBodyUses(responseFixture("response.status")), []);
});

test("mutation guard: same-named custom Response and APIResponse body members remain permitted", () => {
  const customResponse = `
    export {};
    interface Response {
      readonly body: { getReader(): unknown };
      readonly status: number;
      arrayBuffer(): ArrayBuffer;
      blob(): Blob;
      bytes(): Uint8Array;
      formData(): FormData;
      json(): unknown;
      text(): string;
    }
    interface APIResponse {
      body(): Uint8Array;
      json(): unknown;
      status(): number;
      text(): string;
    }
    declare const response: Response;
    declare const apiResponse: APIResponse;
    response.json();
    response["text"]();
    response.arrayBuffer();
    response["blob"]();
    response.bytes();
    response.formData();
    response.body.getReader();
    response["body"].getReader();
    response.status;
    apiResponse.body();
    apiResponse.json();
    apiResponse.text();
    apiResponse.status();
  `;
  assert.deepEqual(findResponseBodyUses(customResponse), []);
});

test("mutation: aliases, destructuring, and intersections cannot hide a DOM body read", () => {
  const aliasedIntersection = `
    type PublicResponse = Response;
    declare const response: PublicResponse & { readonly fixture: true };
    const alias = response;
    const { text } = alias;
    response["json"]();
    void text;
  `;
  assert.deepEqual(
    findResponseBodyUses(aliasedIntersection),
    [
      { category: "consumption", method: "text" },
      { category: "consumption", method: "json" },
    ],
  );
});

test("mutation: DOM Body, inherited Response, and generic constraints retain provenance", () => {
  assert.deepEqual(
    findResponseBodyUses("declare const body: Body;\nbody.bytes();"),
    [{ category: "consumption", method: "bytes" }],
  );
  assert.deepEqual(
    findResponseBodyUses("interface WrappedResponse extends Response {}\ndeclare const response: WrappedResponse;\nresponse.formData();"),
    [{ category: "consumption", method: "formData" }],
  );
  assert.deepEqual(
    findResponseBodyUses("function consume<T extends Response>(response: T): void { response.blob(); }"),
    [{ category: "consumption", method: "blob" }],
  );
});

test("mutation: Playwright and TypeScript 6 body readers are rejected by declaration provenance", () => {
  assert.deepEqual(
    findResponseBodyUsesInProgram(ownershipFixture("playwright-response-body-read.ts")),
    [{ category: "consumption", method: "json" }],
  );
  assert.deepEqual(
    findResponseBodyUsesInProgram(ownershipFixture("playwright-api-response-body-read.ts")),
    [{ category: "consumption", method: "body" }],
  );
  assert.deepEqual(
    findResponseBodyUsesInProgram(ownershipFixture("dom-bytes-body-read.ts")),
    [{ category: "consumption", method: "bytes" }],
  );
});

test("mutation: a body read cannot escape through a reachable local imported helper", () => {
  assert.deepEqual(
    findResponseBodyUsesInProgram(ownershipFixture("imported-helper-root.ts")),
    [{ category: "consumption", method: "text" }],
  );
});

test("mutation: the real UI reachable import graph remains response-body free", () => {
  const uiSpec = fileURLToPath(new URL("./auth-ui.spec.ts", import.meta.url));
  assert.deepEqual(findResponseBodyUsesInProgram(uiSpec), []);
});
