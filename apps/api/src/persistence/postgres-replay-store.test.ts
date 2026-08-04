import { describe, expect, it, vi } from "vitest";

type ReplayQuery = Readonly<{
  name: string;
  text: string;
  values: readonly [Buffer, Date];
}>;

type ReplayDatabase = Readonly<{
  end(): Promise<void>;
  query(config: ReplayQuery): Promise<Readonly<{ rowCount: number | null }> | null>;
}>;

type ReplayStoreInstance = Readonly<{
  consume(jtiDigest: Uint8Array, expiresAt: Date): Promise<boolean>;
  onApplicationShutdown(): Promise<void>;
}>;

type ReplayStoreConstructor = new (database: ReplayDatabase) => ReplayStoreInstance;

const loaded: Record<string, unknown> = await import("./postgres-replay-store.js")
  .catch(() => ({}));
const PostgresReplayStore = loaded.PostgresReplayStore as ReplayStoreConstructor | undefined;
const expiresAt = new Date("2026-07-23T00:00:45.000Z");

function createStore(database: ReplayDatabase): ReplayStoreInstance {
  expect(PostgresReplayStore).toBeTypeOf("function");
  return new PostgresReplayStore!(database);
}

describe("PostgresReplayStore", () => {
  it("uses one named parameterized insert and returns the affected-row decision", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 });
    const end = vi.fn(async () => undefined);
    const store = createStore({ end, query });
    const digest = new Uint8Array(32).fill(7);

    await expect(store.consume(digest, expiresAt)).resolves.toBe(true);
    await expect(store.consume(digest, expiresAt)).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    for (const [config] of query.mock.calls) {
      expect(config).toEqual({
        name: "consume-api-jwt-replay",
        text: "insert into app_private.api_jwt_replays (jti_digest, expires_at) values ($1, $2) on conflict do nothing",
        values: [Buffer.from(digest), expiresAt],
      });
    }
  });

  it.each([
    ["short digest", new Uint8Array(31), expiresAt],
    ["long digest", new Uint8Array(33), expiresAt],
    ["non-byte digest", {} as Uint8Array, expiresAt],
    ["invalid date", new Uint8Array(32), new Date(Number.NaN)],
    ["non-date expiry", new Uint8Array(32), {} as Date],
  ])("rejects %s with only the fixed input error before querying", async (_name, digest, expiry) => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const store = createStore({ end: vi.fn(async () => undefined), query });

    const failure = await store.consume(digest, expiry).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: "REPLAY_INPUT_INVALID",
      name: "ReplayInputInvalidError",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("copies the digest before handing it to the database driver", async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const store = createStore({ end: vi.fn(async () => undefined), query });
    const digest = new Uint8Array(32).fill(7);

    await store.consume(digest, expiresAt);
    const config = query.mock.calls[0]?.[0];
    expect(config).toBeDefined();
    const copiedDigest = config!.values[0];
    digest.fill(9);
    expect(copiedDigest).toEqual(Buffer.alloc(32, 7));
    copiedDigest.fill(5);
    expect(digest).toEqual(new Uint8Array(32).fill(9));
  });

  it.each([null, { rowCount: null }, { rowCount: -1 }, { rowCount: 2 }])(
    "rejects unexpected query result %# with only the fixed operational error",
    async (result) => {
      const query = vi.fn(async () => result);
      const store = createStore({ end: vi.fn(async () => undefined), query });

      const failure = await store.consume(new Uint8Array(32), expiresAt)
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        message: "REPLAY_STORE_UNAVAILABLE",
        name: "ReplayStoreUnavailableError",
      });
    },
  );

  it("replaces database rejection detail with one fixed operational error and does not log", async () => {
    const driverDetail = "postgresql://app:secret@db.invalid digest=deadbeef";
    const query = vi.fn(async () => { throw new Error(driverDetail); });
    const end = vi.fn(async () => undefined);
    const store = createStore({ end, query });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const failure = await store.consume(new Uint8Array(32), expiresAt)
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        message: "REPLAY_STORE_UNAVAILABLE",
        name: "ReplayStoreUnavailableError",
      });
      expect(String(failure)).not.toContain(driverDetail);
      expect(failure).not.toHaveProperty("cause");
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("closes the process-owned pool once across repeated Nest shutdown hooks", async () => {
    const end = vi.fn(async () => undefined);
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const store = createStore({ end, query });

    await Promise.all([
      store.onApplicationShutdown(),
      store.onApplicationShutdown(),
    ]);
    await store.onApplicationShutdown();

    expect(end).toHaveBeenCalledOnce();
  });

  it("rejects consumption after shutdown without querying", async () => {
    const end = vi.fn(async () => undefined);
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const store = createStore({ end, query });
    await store.onApplicationShutdown();

    const failure = await store.consume(new Uint8Array(32), expiresAt)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: "REPLAY_STORE_UNAVAILABLE",
      name: "ReplayStoreUnavailableError",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("replaces pool shutdown rejection detail with one fixed operational error", async () => {
    const end = vi.fn(async () => { throw new Error("pool URL and driver detail"); });
    const store = createStore({
      end,
      query: vi.fn(async () => ({ rowCount: 1 })),
    });

    const failure = await store.onApplicationShutdown().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: "REPLAY_STORE_UNAVAILABLE",
      name: "ReplayStoreUnavailableError",
    });
    expect(String(failure)).not.toMatch(/pool URL|driver detail/u);
    expect(end).toHaveBeenCalledOnce();
  });
});
