// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ApiClientError } from "../../lib/http/api-client.js";
import { buildApiError } from "@account-book/contracts";
const module = await import("./resource-form.js").catch(() => null);
afterEach(cleanup);

it("retains the same intent key and input after an uncertain save, without exposing raw errors", async () => {
  expect(module?.ResourceForm).toBeTypeOf("function");
  const calls: string[] = [];
  let saved = false;
  const Form = module!.ResourceForm;
  render(<Form resource="accounts" onClose={() => undefined} onSaved={() => { saved = true; }} onSave={async (_draft, key) => {
    calls.push(key);
    if (calls.length === 1) throw new Error("raw-private-server-secret");
  }} />);
  await userEvent.type(screen.getByLabelText("계좌 이름"), "생활비");
  await userEvent.click(screen.getByRole("button", { name: "추가하기" }));
  expect((screen.getByLabelText("계좌 이름") as HTMLInputElement).value).toBe("생활비");
  expect(screen.getByRole("alert").textContent).not.toContain("raw-private");
  await userEvent.click(screen.getByRole("button", { name: "추가하기" }));
  expect(calls).toHaveLength(2);
  expect(calls[1]).toBe(calls[0]);
  expect(saved).toBe(true);
});

it("prevents double submission and blocks resubmission after a version conflict", async () => {
  expect(module?.ResourceForm).toBeTypeOf("function");
  let reject!: (error: unknown) => void;
  let count = 0;
  const Form = module!.ResourceForm;
  render(<Form resource="accounts" item={{ id: "11111111-1111-4111-8111-111111111111", name: "기존", kind: "bank", version: 3, archivedAt: null, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", currentBalanceKrw: 0 }} onClose={() => undefined} onSaved={() => undefined} onSave={() => { count++; return new Promise((_resolve, fail) => { reject = fail; }); }} />);
  fireEvent.submit(screen.getByRole("form"));
  fireEvent.submit(screen.getByRole("form"));
  expect(count).toBe(1);
  expect((screen.getByRole("button", { name: "저장 중…" }) as HTMLButtonElement).disabled).toBe(true);
  reject(new ApiClientError(buildApiError({ code: "LEDGER_VERSION_CONFLICT", retryable: false })));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("최신"));
  expect((screen.getByRole("button", { name: "저장하기" }) as HTMLButtonElement).disabled).toBe(true);
});

it("rejects blank names and invalid sort order locally", async () => {
  expect(module?.ResourceForm).toBeTypeOf("function");
  let count = 0;
  const Form = module!.ResourceForm;
  render(<Form resource="categories" onClose={() => undefined} onSaved={() => undefined} onSave={async () => { count++; }} />);
  fireEvent.submit(screen.getByRole("form"));
  expect(screen.getByRole("alert").textContent).toContain("이름");
  await userEvent.type(screen.getByLabelText("카테고리 이름"), "식비");
  fireEvent.change(screen.getByLabelText("정렬 순서"), { target: { value: "-1" } });
  fireEvent.submit(screen.getByRole("form"));
  expect(count).toBe(0);
});
