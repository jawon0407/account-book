import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedJson } from "./http-boundary.js";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

afterEach(() => vi.useRealTimers());
describe("bounded JSON at the BFF", () => {
  it("checks decoded bytes without mistaking gzip wire length for JSON length", async () => {
    const compressed = gzipSync('{"items":[]}');
    const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip", "content-length": compressed.length }); response.end(compressed); });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("TEST_LISTENER_INVALID");
      const response = await fetch(`http://127.0.0.1:${address.port}`, { signal: AbortSignal.timeout(2_000) });
      expect(await boundedJson(response, 100)).toEqual({ items: [] });
    } finally {
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("accepts exact byte limits and matching lengths", async () => {
    expect(await boundedJson(new Response('{"한":1}', { headers: { "content-type": "application/json; charset=utf-8", "content-length": "9" } }), 9)).toEqual({ 한: 1 });
  });
  it.each(["2", "-1", "abc", "0", "99", "9007199254740992", "01", "3, 3"])("rejects invalid or mismatching declared length %s", async (length) => {
    await expect(boundedJson(new Response('{"x":1}', { headers: { "content-type": "application/json", "content-length": length } }), 20)).rejects.toThrow();
  });
  it.each(["text/html", "application/jsonx", "application/json, text/plain", "application/json; charset=iso-8859-1"])("rejects non-JSON or ambiguous type %s", async (type) => {
    await expect(boundedJson(new Response("{}", { headers: { "content-type": type } }), 20)).rejects.toThrow();
  });
  it.each([new Uint8Array([0xff]), new TextEncoder().encode("{bad}"), new Uint8Array()])("rejects invalid UTF-8, malformed or empty JSON", async (body) => {
    await expect(boundedJson(new Response(body, { headers: { "content-type": "application/json" } }), 20)).rejects.toThrow();
  });
  it("bounds a slow browser request and releases its reader", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = boundedJson(new Response(stream, { headers: { "content-type": "application/json" } }), 20);
    const assertion = expect(pending).rejects.toThrow("JSON_TIMEOUT");
    await vi.advanceTimersByTimeAsync(3_001); await assertion;
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false);
  });
});
