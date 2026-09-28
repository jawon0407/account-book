import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runProviderOperation } from "./provider-operation.js";

vi.mock("server-only", () => ({}));

describe("runProviderOperation", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] }));
  afterEach(() => vi.useRealTimers());

  it("rejects a Request already aborted before dispatch without sending credentials", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request("https://example.test", { signal: controller.signal });
    const fetcher = vi.fn<typeof fetch>();
    await expect(runProviderOperation(fetcher, (operation) => operation.fetch(request)))
      .rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(request.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts the real transport signal when headers stall", async () => {
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const result = runProviderOperation(fetcher, (operation) => operation.fetch("https://example.test"));
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts transport and cancels the body when headers arrive but the body stalls", async () => {
    let signal: AbortSignal | null | undefined;
    const abortObserved = vi.fn();
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal;
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          streamController = controller;
        },
      });
      signal?.addEventListener("abort", () => {
        abortObserved();
        streamController.error(new DOMException("aborted", "AbortError"));
      }, { once: true });
      return new Response(body);
    });
    const result = runProviderOperation(fetcher, (operation) => (
      operation.fetch("https://project.supabase.co/auth/v1/token")
    ));
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(abortObserved).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a provider response status, status text, headers, and body", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{"retry":true}', {
      status: 429,
      statusText: "Too Many Requests",
      headers: { "content-type": "application/json", "retry-after": "3" },
    }));

    const result = await runProviderOperation(fetcher, async (operation) => {
      const response = await operation.fetch("https://example.test");
      return {
        body: await response.json(),
        contentType: response.headers.get("content-type"),
        retryAfter: response.headers.get("retry-after"),
        status: response.status,
        statusText: response.statusText,
      };
    });

    expect(result).toEqual({
      body: { retry: true },
      contentType: "application/json",
      retryAfter: "3",
      status: 429,
      statusText: "Too Many Requests",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["transport", vi.fn<typeof fetch>(async () => { throw new Error("secret-token-in-raw-error"); })],
    ["body", vi.fn<typeof fetch>(async () => new Response(new ReadableStream<Uint8Array>({
      pull: () => { throw new Error("secret-token-in-body-error"); },
    })))],
  ] as const)("hides a raw %s error", async (_source, fetcher) => {
    await expect(runProviderOperation(fetcher, async (operation) => {
      const response = await operation.fetch("https://example.test/private-url");
      return response.text();
    })).rejects.toMatchObject({
      code: "AUTH_PROVIDER_UNAVAILABLE",
      message: "AUTH_PROVIDER_UNAVAILABLE",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([204, 205, 304] as const)("returns a valid bodyless response for status %s", async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status }));

    const result = await runProviderOperation(fetcher, async (operation) => {
      const response = await operation.fetch("https://example.test");
      return { body: await response.text(), status: response.status };
    });

    expect(result).toEqual({ body: "", status });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["CANARY_PRIVATE_TOKEN_invalid_json", ""])("preserves actual 429 when JSON decoding fails for body %s", async (body) => {
    const result = await runProviderOperation(async () => new Response(body, { status: 429 }), async (operation) => {
      const response = await operation.fetch("https://example.test");
      return { status: response.status, body: await response.json() };
    });

    expect(result).toEqual({ status: 429, body: { message: "AUTH_RATE_LIMITED" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves valid JSON bytes without reserializing them", async () => {
    const body = ' \n { "message": "한글", "value": 1.00 }\n';
    const response = await runProviderOperation(async () => new Response(body), (operation) => operation.fetch("https://example.test"));

    expect(await response.text()).toBe(body);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks the monotonic deadline after JSON decoding before handing a response to the SDK", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const decode = TextDecoder.prototype.decode;
    const decoding = vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (this: TextDecoder, ...args) {
      const text = decode.apply(this, args);
      now.mockReturnValue(5_000);
      return text;
    });
    let guardedResult: Promise<Response> | undefined;
    const result = runProviderOperation(async () => new Response("{}"), (operation) => {
      guardedResult = operation.fetch("https://example.test");
      return guardedResult;
    });

    try {
      await expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
      expect((await guardedResult)?.status).toBe(408);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      decoding.mockRestore();
      now.mockRestore();
    }
  });

  it.each(["init", "request"] as const)(
    "honors %s cancellation without aborting the caller controller",
    async (source) => {
      const external = new AbortController();
      const remove = vi.spyOn(external.signal, "removeEventListener");
      const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
      const input = source === "request"
        ? new Request("https://example.test", { signal: external.signal })
        : "https://example.test";
      const result = runProviderOperation(fetcher, (operation) => operation.fetch(
        input,
        source === "init" ? { signal: external.signal } : undefined,
      ));
      const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
      await vi.advanceTimersByTimeAsync(0);

      external.abort();

      await rejected;
      expect(external.signal.aborted).toBe(true);
      expect(remove).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not abort the caller controller on its own timeout", async () => {
    const external = new AbortController();
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const result = runProviderOperation(fetcher, (operation) => operation.fetch(
      "https://example.test",
      { signal: external.signal },
    ));
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejected;
    expect(external.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts a late transport after the operation settled", async () => {
    let retained!: typeof fetch;
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));

    await runProviderOperation(fetcher, async (operation) => {
      retained = operation.fetch;
    });

    expect((await retained("https://example.test")).status).toBe(408);
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a success at the exact monotonic deadline", async () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);
    const fetcher = vi.fn<typeof fetch>();
    const result = runProviderOperation(fetcher, async () => {
      now.mockReturnValue(5_000);
      return "late";
    });

    await expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a late response body after a non-cooperative fetch resolves", async () => {
    let resolveFetch!: (response: Response) => void;
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const result = runProviderOperation(fetcher, (operation) => operation.fetch("https://example.test"));
    const rejected = expect(result).rejects.toMatchObject({ code: "AUTH_PROVIDER_UNAVAILABLE" });

    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    resolveFetch(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await vi.runAllTicks();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maps an unexpected work failure and clears the operation timer", async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(runProviderOperation(fetcher, async () => {
      throw new Error("secret-token-in-work-error");
    })).rejects.toMatchObject({
      code: "AUTH_PROVIDER_UNAVAILABLE",
      message: "AUTH_PROVIDER_UNAVAILABLE",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
