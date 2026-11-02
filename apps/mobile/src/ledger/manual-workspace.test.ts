import { describe, expect, it, vi } from "vitest";
import type { Profile, Transaction } from "@account-book/contracts";
import { ClientError } from "../api/client-error";
import { ManualWorkspace } from "./manual-workspace";

const user = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const stamp = "2026-10-16T00:00:00.000Z";
const profile: Profile = {
  id: user,
  nickname: null,
  avatarObjectKey: null,
  signupProvider: "email",
  role: "member",
  ledgerTimeZone: "Asia/Seoul",
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
};
const saved: Transaction = {
  id: other,
  kind: "expense",
  amountKrw: 20000,
  occurredOn: "2026-10-16",
  accountId: null,
  categoryId: null,
  counterpartyName: null,
  memo: null,
  transferId: null,
  version: 1,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
};
function fixture() {
  const api = {
    profile: vi.fn(async () => profile),
    accounts: vi.fn(async () => ({ items: [] })),
    categories: vi.fn(async () => ({ items: [] })),
    updateProfile: vi.fn(async () => ({ ...profile, version: 2 })),
    createTransaction: vi.fn(async () => saved),
  };
  const workspace = new ManualWorkspace(
    api,
    () => "22222222-2222-4222-8222-222222222222",
    () => "2026-10-16",
    () => "Asia/Seoul",
  );
  return { workspace, api };
}
async function ready(workspace: ManualWorkspace) {
  workspace.acceptSession({ status: "ready", userId: user });
  await workspace.load();
}

describe("account-owned manual workspace", () => {
  it("preserves manual draft through collector settings and clears it on logout", async () => {
    const { workspace } = fixture();
    await ready(workspace);
    workspace.open("manual");
    workspace.edit({ amount: "20,000", memo: "unfinished manual entry" });
    const draft = workspace.snapshot().draft;
    workspace.open("collector");
    expect(workspace.snapshot().screen).toBe("collector");
    workspace.open("ledger");
    workspace.open("manual");
    expect(workspace.snapshot().draft).toEqual(draft);
    workspace.acceptSession({ status: "signed_out" });
    expect(workspace.snapshot().draft).toBeNull();
    expect(workspace.snapshot().screen).toBe("ledger");
  });
  it("makes no reference requests before a ready session", async () => {
    const { workspace, api } = fixture();
    await workspace.load();
    expect(api.profile).not.toHaveBeenCalled();
    expect(workspace.snapshot().entry).toBeNull();
  });
  it("retains draft and attempt through verification, but disposes them on logout", async () => {
    const { workspace } = fixture();
    await ready(workspace);
    workspace.edit({ amount: "20,000", memo: "local draft" });
    const entry = workspace.snapshot().entry!;
    workspace.acceptSession({ status: "verifying" });
    expect(workspace.snapshot().draft?.memo).toBe("local draft");
    expect(workspace.edit({ amount: "1" })).toBe(false);
    workspace.acceptSession({ status: "ready", userId: user });
    expect(workspace.snapshot().entry).toBe(entry);
    workspace.acceptSession({ status: "busy" });
    expect(entry.snapshot().status).toBe("disposed");
    expect(workspace.snapshot().draft).toBeNull();
  });
  it("a different account never receives the previous draft", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    workspace.edit({ amount: "20,000" });
    api.profile.mockResolvedValue({ ...profile, id: other });
    workspace.acceptSession({ status: "ready", userId: other });
    await workspace.load();
    expect(workspace.snapshot().draft?.amount).toBe("");
    expect(workspace.snapshot().ownerId).toBe(other);
  });
  it("ignores late reference results after account disposal", async () => {
    const { workspace, api } = fixture();
    let finish!: (value: Profile) => void;
    api.profile.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    workspace.acceptSession({ status: "ready", userId: user });
    const pending = workspace.load();
    workspace.acceptSession({ status: "signed_out" });
    finish(profile);
    await pending;
    expect(workspace.snapshot().context).toBeNull();
    expect(workspace.snapshot().profile).toBeNull();
  });
  it("clears category on direction change and DST choice on clock changes", async () => {
    const { workspace } = fixture();
    await ready(workspace);
    workspace.edit({ categoryId: other, timeChoice: "earlier" });
    workspace.edit({ type: "income", clock: "12:30" });
    expect(workspace.snapshot().draft).toMatchObject({
      categoryId: null,
      timeChoice: null,
    });
  });
  it("locks uncertain input and only unlocks after an explicit successful list check", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    workspace.edit({ amount: "20,000" });
    api.createTransaction.mockRejectedValue(new ClientError("NETWORK"));
    await expect(workspace.submit()).rejects.toMatchObject({ code: "NETWORK" });
    expect(workspace.edit({ amount: "1" })).toBe(false);
    expect(workspace.resetAfterListCheck()).toBe(false);
    workspace.markListChecked(workspace.beginListCheck());
    expect(workspace.resetAfterListCheck()).toBe(true);
    expect(workspace.snapshot().draft?.amount).toBe("");
  });
  it("refreshes the list version only after confirmed save", async () => {
    const { workspace } = fixture();
    await ready(workspace);
    workspace.edit({ amount: "20,000" });
    await workspace.submit();
    expect(workspace.snapshot()).toMatchObject({
      screen: "ledger",
      listVersion: 1,
    });
    workspace.open("manual");
    expect(workspace.snapshot().draft?.amount).toBe("");
    expect(workspace.snapshot().entry?.snapshot().status).toBe("editing");
  });
  it("requires a new list check after every uncertain retry", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    workspace.edit({ amount: "20,000" });
    api.createTransaction.mockRejectedValue(new ClientError("NETWORK"));
    await expect(workspace.submit()).rejects.toMatchObject({ code: "NETWORK" });
    workspace.markListChecked(workspace.beginListCheck());
    await expect(workspace.retry()).rejects.toMatchObject({ code: "NETWORK" });
    expect(workspace.snapshot().listChecked).toBe(false);
    expect(workspace.resetAfterListCheck()).toBe(false);
  });
  it("uses expectedVersion for explicit residence changes, then reloads references", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    await workspace.setResidence("America/New_York");
    expect(api.updateProfile).toHaveBeenCalledWith({
      ledgerTimeZone: "America/New_York",
      expectedVersion: 1,
    });
  });
  it("does not accept a list request started before uncertainty or before a retry", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    workspace.edit({ amount: "20,000" });
    let reject!: (cause: unknown) => void;
    api.createTransaction.mockImplementationOnce(
      () =>
        new Promise((_, no) => {
          reject = no;
        }),
    );
    const save = workspace.submit();
    const oldList = workspace.beginListCheck();
    reject(new ClientError("NETWORK"));
    await expect(save).rejects.toMatchObject({ code: "NETWORK" });
    workspace.markListChecked(oldList);
    expect(workspace.resetAfterListCheck()).toBe(false);
    const staleUncertainList = workspace.beginListCheck();
    api.createTransaction.mockRejectedValueOnce(new ClientError("NETWORK"));
    await expect(workspace.retry()).rejects.toMatchObject({ code: "NETWORK" });
    workspace.markListChecked(staleUncertainList);
    expect(workspace.resetAfterListCheck()).toBe(false);
    workspace.markListChecked(workspace.beginListCheck());
    expect(workspace.resetAfterListCheck()).toBe(true);
  });
  it("rejects a residence continuation after switching accounts during the reload", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    workspace.open("residence");
    let finish!: (value: Profile) => void;
    api.profile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const update = workspace.setResidence("Asia/Tokyo");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    workspace.acceptSession({ status: "ready", userId: other });
    finish(profile);
    await expect(update).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(workspace.snapshot().screen).toBe("ledger");
  });
  it("does not navigate back after the user leaves residence settings during reload", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    workspace.open("residence");
    let finish!: (value: Profile) => void;
    api.profile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const update = workspace.setResidence("Asia/Tokyo");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    workspace.open("ledger");
    finish(profile);
    await update;
    expect(workspace.snapshot().screen).toBe("ledger");
  });
  it("refreshes profile after a rejected residence update without automatic retry", async () => {
    const { workspace, api } = fixture();
    await ready(workspace);
    api.updateProfile.mockRejectedValue(
      new ClientError("LEDGER_VERSION_CONFLICT", 409),
    );
    const before = api.profile.mock.calls.length;
    await expect(workspace.setResidence("Asia/Tokyo")).rejects.toMatchObject({
      code: "LEDGER_VERSION_CONFLICT",
    });
    expect(api.updateProfile).toHaveBeenCalledTimes(1);
    expect(api.profile.mock.calls.length).toBeGreaterThan(before);
  });
});
