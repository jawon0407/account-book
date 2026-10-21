import { describe, expect, it, vi } from "vitest";
const { nativeFetch } = vi.hoisted(() => ({ nativeFetch: vi.fn() }));
vi.mock("expo/fetch", () => ({ fetch: nativeFetch }));
import { androidTransport } from "./android-transport";

describe("Android native transport policy", () => {
  it("passes redirect error and cookie omission explicitly even when Request loses them", async () => {
    const response = new Response("{}");
    nativeFetch.mockResolvedValueOnce(response);
    const request = new Request(
      "https://ledger.example/api/native/auth/sign-in",
      { method: "POST", body: '{"synthetic":true}' },
    );
    const controller = new AbortController();
    await expect(
      androidTransport(request, {
        signal: controller.signal,
        redirect: "follow",
        credentials: "include",
      }),
    ).resolves.toBe(response);
    expect(nativeFetch).toHaveBeenCalledWith(request, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
    });
  });
  it("does not fall back to global fetch when native transport rejects a redirect", async () => {
    const global = vi.spyOn(globalThis, "fetch");
    nativeFetch.mockRejectedValueOnce(new Error("redirect denied"));
    await expect(androidTransport("https://ledger.example")).rejects.toThrow(
      "redirect denied",
    );
    expect(global).not.toHaveBeenCalled();
    global.mockRestore();
  });
});
