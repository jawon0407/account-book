import { expect, it, vi } from "vitest";
import { safeUrl } from "./validation.js";

vi.mock("server-only", () => ({}));

it("rejects an unparseable URL without retaining the submitted value", () => {
  expect(() => safeUrl("not-a-url-private-input", false)).toThrow("AUTH_PROVIDER_UNAVAILABLE");
});
