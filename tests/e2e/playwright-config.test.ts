import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { findResponseBodyUses } from "./response-body-ownership.js";

const responseFixture = (expression: string): string => `declare const response: Response;\n${expression};`;

test("routes browser journeys and HTTP contracts to separate Playwright projects", async () => {
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

test("rejects DOM Response body consumption in dot, bracket, and computed forms", () => {
  const forbiddenMethods = ["json", "text", "arrayBuffer", "blob", "formData"] as const;

  for (const method of forbiddenMethods) {
    assert.deepEqual(findResponseBodyUses(responseFixture(`response.${method}()`)), [{ category: "consumption", method }]);
    assert.deepEqual(findResponseBodyUses(responseFixture(`response["${method}"]()`)), [{ category: "consumption", method }]);
  }
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

test("allows status-only access on a DOM Response", () => {
  assert.deepEqual(findResponseBodyUses(responseFixture('const property = "status" as const;\nresponse[property]')), []);
  assert.deepEqual(findResponseBodyUses(responseFixture("response.status")), []);
});

test("allows body-like members on a custom non-DOM Response", () => {
  const customResponse = `
    export {};
    interface Response {
      readonly body: { getReader(): unknown };
      readonly status: number;
      arrayBuffer(): ArrayBuffer;
      blob(): Blob;
      formData(): FormData;
      json(): unknown;
      text(): string;
    }
    declare const response: Response;
    response.json();
    response["text"]();
    response.arrayBuffer();
    response["blob"]();
    response.formData();
    response.body.getReader();
    response["body"].getReader();
    response.status;
  `;
  assert.deepEqual(findResponseBodyUses(customResponse), []);
});

test("resolves DOM Response aliases and intersections", () => {
  const aliasedIntersection = `
    type PublicResponse = Response;
    declare const response: PublicResponse & { readonly fixture: true };
    response["json"]();
  `;
  assert.deepEqual(
    findResponseBodyUses(aliasedIntersection),
    [{ category: "consumption", method: "json" }],
  );
});

test("keeps the real UI spec free of DOM Response body use", () => {
  const uiSpec = readFileSync(new URL("./auth-ui.spec.ts", import.meta.url), "utf8");
  assert.deepEqual(findResponseBodyUses(uiSpec), []);
});
