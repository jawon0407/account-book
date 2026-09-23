import { expect, it, vi } from "vitest";
import { safeUrl } from "./validation.js";

vi.mock("server-only", () => ({}));

it.each(["not-a-url-private-input", undefined, null, 42])("rejects malformed URL input without retaining the submitted value %#", (value) => {
  expect(() => safeUrl(value, false)).toThrow("AUTH_PROVIDER_UNAVAILABLE");
});
