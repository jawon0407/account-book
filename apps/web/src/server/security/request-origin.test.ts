import { describe, expect, it } from "vitest";

const csrfModule = await import("./csrf.js").catch(() => ({} as Record<string, unknown>));
const requestModule = await import("./request-origin.js").catch(() => ({} as Record<string, unknown>));
const issueCsrfToken = csrfModule.issueCsrfToken as ((context: unknown, now: Date, key: Uint8Array) => string) | undefined;
const verifyCsrfRequest = requestModule.verifyCsrfRequest as ((request: unknown, context: unknown, policy: unknown) => void) | undefined;
const AuthRequestRejectedError = requestModule.AuthRequestRejectedError as (new () => Error) | undefined;

const selector = Buffer.alloc(32, 12).toString("base64url");
const key = Buffer.alloc(32, 13);
const now = new Date("2040-01-01T00:00:00.000Z");
const context = { selector };
const policy = { now, key, allowedOrigins: new Set(["https://app.example.test"]) };

function request(headers: Record<string, string>, method = "POST"): { method: string; headers: Headers } {
  return { method, headers: new Headers(headers) };
}

function rawRequest(headers: Record<string, string>, method = "POST"): { method: string; headers: { get(name: string): string | null } } {
  return { method, headers: { get: (name) => headers[name] ?? null } };
}

function validToken(): string {
  expect(issueCsrfToken).toBeTypeOf("function");
  return issueCsrfToken?.(context, now, key) ?? "";
}

function validHeaders(token = validToken()): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "X-CSRF-Token": token,
    Origin: "https://app.example.test",
    "Sec-Fetch-Site": "same-origin",
  };
}

function expectRejected(input: unknown, supplied = "", activePolicy: unknown = policy): void {
  expect(AuthRequestRejectedError).toBeTypeOf("function");
  expect(() => verifyCsrfRequest?.(input, context, activePolicy)).toThrow(AuthRequestRejectedError);
  try {
    verifyCsrfRequest?.(input, context, activePolicy);
  } catch (error) {
    expect((error as Error).message).toBe("AUTH_CSRF_REJECTED");
    if (supplied !== "") expect((error as Error).message).not.toContain(supplied);
  }
}

describe("state-changing request boundary", () => {
  it("accepts an exact same-origin JSON POST with a bound CSRF token", () => {
    expect(verifyCsrfRequest).toBeTypeOf("function");
    expect(() => verifyCsrfRequest?.(request(validHeaders()), context, policy)).not.toThrow();
  });

  it("permits a same-origin Referer fallback only when Origin is absent", () => {
    const headers = validHeaders();
    delete headers.Origin;
    headers.Referer = "https://app.example.test/path?source=test#fragment";
    expect(() => verifyCsrfRequest?.(request(headers), context, policy)).not.toThrow();
  });

  it.each([
    ["invalid request", null],
    ["invalid headers", { method: "POST", headers: null }],
    ["non-string header", { method: "POST", headers: { get: () => 1 } }],
    ["wrong method", request(validHeaders(), "post")],
    ["GET method", request(validHeaders(), "GET")],
    ["missing type", request({ ...validHeaders(), "Content-Type": "" })],
    ["lookalike type", request({ ...validHeaders(), "Content-Type": "application/jsonx" })],
    ["multiple type", request({ ...validHeaders(), "Content-Type": "application/json, text/plain" })],
    ["missing token", request(Object.fromEntries(Object.entries(validHeaders()).filter(([name]) => name !== "X-CSRF-Token")))],
    ["tampered token", request(validHeaders("v1.0.bad.bad"))],
    ["cross-site", request({ ...validHeaders(), "Sec-Fetch-Site": "cross-site" })],
    ["same-site", request({ ...validHeaders(), "Sec-Fetch-Site": "same-site" })],
    ["missing fetch site", request({ ...validHeaders(), "Sec-Fetch-Site": "" })],
    ["invalid fetch site", request({ ...validHeaders(), "Sec-Fetch-Site": "other" })],
    ["navigation", request({ ...validHeaders(), "Sec-Fetch-Mode": "navigate" })],
    ["coalesced navigation mode", rawRequest({ ...validHeaders(), "Sec-Fetch-Mode": "navigate, cors" })],
    ["case-variant mode", rawRequest({ ...validHeaders(), "Sec-Fetch-Mode": "CORS" })],
    ["unknown mode", rawRequest({ ...validHeaders(), "Sec-Fetch-Mode": "websocket" })],
    ["resource destination", request({ ...validHeaders(), "Sec-Fetch-Dest": "document" })],
    ["coalesced resource destination", rawRequest({ ...validHeaders(), "Sec-Fetch-Dest": "empty, document" })],
  ])("rejects a %s request", (_name, input) => {
    expectRejected(input);
  });

  it.each([
    "",
    "https://attacker.invalid",
    "https://user:pass@app.example.test",
    "https://app.example.test/path",
    "https://app.example.test?query=1",
    "https://app.example.test#fragment",
    "https://app.example.test,https://attacker.invalid",
    " https://app.example.test",
    "https://app.example.test ",
    "not a url",
  ])("rejects an invalid, non-canonical, or disallowed Origin", (origin) => {
    expectRejected(rawRequest({ ...validHeaders(), Origin: origin }), origin);
  });

  it.each(["\r", "\n", "\t", "\0", "\x7f"])('rejects an Origin containing a control character without echoing it', (control) => {
    const origin = `https://app.example.${control}test`;
    expectRejected(rawRequest({ ...validHeaders(), Origin: origin }), origin);
  });

  it.each([
    "",
    "https://attacker.invalid/path",
    "not a url",
    "https://user:pass@app.example.test/path",
  ])("rejects a missing or disallowed Referer when Origin is absent", (referer) => {
    const headers = validHeaders();
    delete headers.Origin;
    if (referer !== "") headers.Referer = referer;
    expectRejected(request(headers), referer);
  });

  it.each(["\r", "\n", "\t", "\0", "\x7f"])('rejects a Referer containing a control character without echoing it', (control) => {
    const headers = validHeaders();
    delete headers.Origin;
    const referer = `https://app.example.${control}test/path`;
    headers.Referer = referer;
    expectRejected(rawRequest(headers), referer);
  });

  it.each([
    new Set(["https://app.example.test/path"]),
    new Set(["ftp://app.example.test"]),
    new Set(["https://user:pass@app.example.test"]),
    new Set(["https://app.example.test", "https://app.example.test/"]),
  ])("fails closed for a non-canonical allowed-origin policy", (allowedOrigins) => {
    expectRejected(request(validHeaders()), "", { ...policy, allowedOrigins });
  });

  it("fails closed for a missing policy or an empty allowed-origin set", () => {
    expectRejected(request(validHeaders()), "", null);
    expectRejected(request(validHeaders()), "", { ...policy, allowedOrigins: new Set() });
  });

  it.each(["\r", "\n", "\t", "\0", "\x7f"])('rejects an allowed-origin configuration containing a control character', (control) => {
    expectRejected(request(validHeaders()), "", { ...policy, allowedOrigins: new Set([`https://app.example.${control}test`]) });
  });

  it.each([
    ["content type", "Content-Type", "application/json\n"],
    ["fetch site", "Sec-Fetch-Site", "same-origin\t"],
    ["fetch mode", "Sec-Fetch-Mode", "cors\r"],
    ["fetch destination", "Sec-Fetch-Dest", "\0"],
    ["CSRF token", "X-CSRF-Token", `${validToken()}\n`],
  ])("rejects a %s header containing a control character", (_name, headerName, value) => {
    expectRejected(rawRequest({ ...validHeaders(), [headerName]: value }), value);
  });

  it("accepts Fetch Metadata none and absent mode/dest after all required checks", () => {
    expect(() => verifyCsrfRequest?.(request({ ...validHeaders(), "Sec-Fetch-Site": "none" }), context, policy)).not.toThrow();
    expect(() => verifyCsrfRequest?.(request({ ...validHeaders(), "Sec-Fetch-Mode": "cors" }), context, policy)).not.toThrow();
    expect(() => verifyCsrfRequest?.(request({ ...validHeaders(), "Sec-Fetch-Mode": "same-origin" }), context, policy)).not.toThrow();
    expect(() => verifyCsrfRequest?.(request({ ...validHeaders(), "Sec-Fetch-Mode": "no-cors" }), context, policy)).not.toThrow();
  });

  it("accepts the standard fetch destination after all required checks", () => {
    expect(() => verifyCsrfRequest?.(request({
      ...validHeaders(),
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    }), context, policy)).not.toThrow();
  });
});
