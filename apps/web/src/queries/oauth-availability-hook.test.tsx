// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useOAuthAvailability } from "./oauth-availability.js";

const get = vi.hoisted(() => vi.fn());
vi.mock("../lib/http/api-client.js", () => ({ apiClient: { get }, apiError: async () => new Error("AUTH_PROVIDER_UNAVAILABLE") }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("hides stale enabled providers during revalidation and after an error", async () => {
  const client = new QueryClient();
  get.mockReturnValueOnce({ json: async () => ({ enabledProviders: ["google"] }) });
  const { result } = renderHook(useOAuthAvailability, {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  try {
    await waitFor(() => expect(result.current).toEqual({ enabledProviders: ["google"], availability: "ready" }));
    let reject!: (reason: Error) => void;
    get.mockReturnValueOnce({ json: () => new Promise((_resolve, fail) => { reject = fail; }) });
    act(() => { void client.invalidateQueries({ queryKey: ["auth", "oauth-availability"] }); });
    await waitFor(() => expect(result.current).toEqual({ enabledProviders: [], availability: "loading" }));
    act(() => reject(new Error("private upstream detail")));
    await waitFor(() => expect(result.current).toEqual({ enabledProviders: [], availability: "unavailable" }));
    expect(client.getQueryData(["auth", "oauth-availability"])).toEqual({ enabledProviders: ["google"] });
  } finally { client.clear(); }
});
