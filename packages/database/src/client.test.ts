import { afterEach, describe, expect, it, vi } from "vitest";
import { createDatabaseClient } from "./client.js";

describe("createDatabaseClient idle pool error boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports only the first idle error without exposing event details", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = createDatabaseClient("postgresql://test:fake-secret@localhost/test");
    diagnostic.mockImplementation(() => {
      database.$client.emit("error", new Error("nested-secret"));
    });
    try {
      expect(() => database.$client.emit("error", new Error("fake-secret SQL detail"), { password: "fake-secret" })).not.toThrow();
      expect(() => database.$client.emit("error", new Error("second-secret"))).not.toThrow();
      expect(diagnostic.mock.calls).toEqual([["DB_POOL_IDLE_ERROR source=bff"]]);
    } finally {
      await database.$client.end();
      diagnostic.mockRestore();
    }
  });

  it("reports the first idle error independently for each pool", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = createDatabaseClient("postgresql://test:first-secret@localhost/test");
    const second = createDatabaseClient("postgresql://test:second-secret@localhost/test");
    try {
      expect(() => first.$client.emit("error", new Error("first-secret"))).not.toThrow();
      expect(() => second.$client.emit("error", new Error("second-secret"))).not.toThrow();
      expect(diagnostic.mock.calls).toEqual([
        ["DB_POOL_IDLE_ERROR source=bff"],
        ["DB_POOL_IDLE_ERROR source=bff"],
      ]);
    } finally {
      await Promise.all([first.$client.end(), second.$client.end()]);
      diagnostic.mockRestore();
    }
  });

  it("does not propagate a synchronous diagnostic failure", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("diagnostic unavailable");
    });
    const database = createDatabaseClient("postgresql://test:fake-secret@localhost/test");
    try {
      expect(() => database.$client.emit("error", new Error("fake-secret"))).not.toThrow();
      expect(() => database.$client.emit("error", new Error("second-secret"))).not.toThrow();
      expect(diagnostic).toHaveBeenCalledOnce();
    } finally {
      await database.$client.end();
      diagnostic.mockRestore();
    }
  });
});
