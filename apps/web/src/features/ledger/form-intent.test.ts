import { expect, it } from "vitest";

const module = await import("./form-intent.js").catch(() => null);

it("reuses a create key only for the same payload and rotates after changes", () => {
  expect(module?.createIntent).toBeTypeOf("function");
  const intent = module!.createIntent();
  const first = intent.keyFor({ name: "생활비", kind: "bank" });
  expect(first).toMatch(/^[0-9a-f-]{14}4[0-9a-f-]{21}$/u);
  expect(intent.keyFor({ name: "생활비", kind: "bank" })).toBe(first);
  expect(intent.keyFor({ name: "비상금", kind: "bank" })).not.toBe(first);
  expect(intent.keyFor({ name: "생활비", kind: "bank" })).not.toBe(first);
});
