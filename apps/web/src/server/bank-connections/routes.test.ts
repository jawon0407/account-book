import { describe, expect, it, vi } from "vitest";
import { handleBankRoute, unsupportedBankRoute } from "./route-adapter.js";

vi.mock("server-only", () => ({}));
vi.mock("../container.js", () => ({ createRequestContainer: () => { throw new Error("private-config"); } }));

describe("bank route adapter", () => {
  it("does not disclose dependency construction failures", async () => {
    const response = await handleBankRoute("start", new Request("https://web.invalid/api/bank-connections/kftc/start"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-config");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
  it("awaits the exact dynamic ID and returns the controller response", async () => {
    const reply = Response.json({ safe: true }); const handle = vi.fn(async () => reply);
    expect(await handleBankRoute("status", new Request("https://web.invalid"), { params: Promise.resolve({ requestId: "opaque-id" }) }, () => ({ bankController: { handle } }))).toBe(reply);
    expect(handle).toHaveBeenCalledWith("status", expect.any(Request), "opaque-id");
  });
  it("rejects unsupported HTTP methods without container construction", () => {
    expect(unsupportedBankRoute().status).toBe(405);
  });
});
