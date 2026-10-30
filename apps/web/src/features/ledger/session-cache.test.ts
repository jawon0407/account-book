import { expect, it } from "vitest";
import { buildApiError } from "@account-book/contracts";
import { ApiClientError } from "../../lib/http/api-client.js";
const module = await import("./session-cache.js").catch(() => null);

it("locks the workspace on authentication errors, not ordinary version conflicts", async () => {
  expect(module?.createPrivateClient).toBeTypeOf("function");
  let expired = 0;
  const client = module!.createPrivateClient(() => { expired += 1; });
  for (const code of ["LEDGER_VERSION_CONFLICT", "AUTH_SESSION_EXPIRED"] as const) {
    await client.fetchQuery({ queryKey: [code], queryFn: () => { throw new ApiClientError(buildApiError({ code, retryable: false })); } }).catch(() => undefined);
  }
  expect(expired).toBe(1);
  client.clear();
});

it("cancels late responses and removes sensitive data on logout", async () => {
  expect(module?.purgePrivateClient).toBeTypeOf("function");
  const client = module!.createPrivateClient(() => undefined);
  client.setQueryData(["ledger", "user-a", "accounts"], { name: "개인 계좌" });
  let resolve!: (value: string) => void;
  const pending = client.fetchQuery({ queryKey: ["ledger", "user-a", "profile"], queryFn: () => new Promise<string>((done) => { resolve = done; }) }).catch(() => undefined);
  await module!.purgePrivateClient(client);
  resolve("late secret");
  await pending;
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});
