import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("keeps response bodies and logout handling in the HTTP contract spec", () => {
  // UI and HTTP specs run in separate projects, so source ownership is the closest executable boundary.
  const uiSpec = readFileSync(new URL("./auth-ui.spec.ts", import.meta.url), "utf8");

  assert.equal(uiSpec.includes("/api/auth/csrf"), false, "UI spec must not fetch CSRF response bodies");
  assert.equal(uiSpec.includes("/api/auth/sign-out"), false, "UI spec must not own logout requests");
  assert.equal(uiSpec.includes(".json()"), false, "UI spec must not parse response bodies");
});
