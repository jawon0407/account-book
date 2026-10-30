import { expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-secure-store", () => native);
import { secureStorage } from "./secure-storage";
it("uses the dedicated SecureStore namespace for every operation", async () => {
  native.getItemAsync.mockResolvedValue("opaque");
  expect(await secureStorage.get("session")).toBe("opaque");
  await secureStorage.set("session", "opaque");
  await secureStorage.remove("session");
  for (const fn of Object.values(native)) {
    expect(fn.mock.calls[0]?.at(-1)).toEqual({
      keychainService: "account-book-native-v1",
    });
  }
});
it("propagates native storage failure so manager can block login", async () => {
  native.setItemAsync.mockRejectedValueOnce(new Error("disk"));
  await expect(secureStorage.set("session", "opaque")).rejects.toThrow("disk");
});
