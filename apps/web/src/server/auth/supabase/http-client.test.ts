import { expect, it, vi } from "vitest";
import { requestSupabaseAuth } from "./http-client.js";

vi.mock("server-only", () => ({}));

it.each([200, 503])("handles malformed JSON without losing HTTP status %s", async (status) => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response("not-json", { status }));
  const pending = requestSupabaseAuth(
    { url: "https://provider.example.test/", anonKey: "test-only-key" },
    fetcher, new URL("https://provider.example.test/auth/v1/token"), { code: "test-code" },
  );
  if (status === 200) await expect(pending).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
  else await expect(pending).resolves.toEqual({ ok: false, status: 503, body: null });
});
