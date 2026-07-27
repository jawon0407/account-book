import assert from "node:assert/strict";
import test from "node:test";

test("mutation: project routing, serial execution, or trace-off policy cannot drift", async () => {
  process.env.TEST_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/account_book_test";
  process.env.TEST_DATABASE_DISPOSABLE = "true";
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { default: config } = await import("./playwright.config.js");
  const projects = new Map((config.projects ?? []).map((project) => [project.name, project]));

  assert.deepEqual([...projects.keys()].sort(), ["http-contract", "ui-desktop-1440x900", "ui-mobile-390x844"]);
  assert.equal(projects.get("ui-mobile-390x844")?.testMatch, "ui/auth-ui.spec.ts");
  assert.equal(projects.get("ui-desktop-1440x900")?.testMatch, "ui/auth-ui.spec.ts");
  assert.equal(projects.get("http-contract")?.testMatch, "auth-response.spec.ts");
  assert.equal(config.fullyParallel, false);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
  assert.equal(config.use?.trace, "off");
});
