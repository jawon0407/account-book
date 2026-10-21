import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { oauthAvailabilityOptions } from "./oauth-availability.js";
import type { BrowserApiClient } from "../lib/http/api-client.js";

/** @param payload 합성 HTTP 응답. 실제 query 실행으로 경로와 응답 검증을 확인한다. */
async function fetchAvailability(payload: unknown) {
  const client = new QueryClient();
  const http: BrowserApiClient = {
    get(path) { expect(path).toBe("auth/providers"); return { json: async <T>() => payload as T }; },
    post() { throw new Error("POST must not be used"); },
  };
  try { return await client.fetchQuery(oauthAvailabilityOptions(http)); }
  finally { client.clear(); }
}

it("accepts empty and partial enabled lists", async () => {
  expect(await fetchAvailability({ enabledProviders: [] })).toEqual({ enabledProviders: [] });
  expect(await fetchAvailability({ enabledProviders: ["google", "kakao"] })).toEqual({ enabledProviders: ["google", "kakao"] });
});

it.each([{ enabledProviders: ["facebook"] }, { enabledProviders: ["google", "google"] }, { enabledProviders: ["google"], secret: "hidden" }, null])("rejects unsafe public configuration without leaking the response", async (value) => {
  await expect(fetchAvailability(value)).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
});
