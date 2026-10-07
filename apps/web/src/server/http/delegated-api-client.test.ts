import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  DelegatedApiClient,
  type DelegatedApiRequest,
} from "./delegated-api-client.js";
import type { DelegatedSignInput } from "../security/delegated-jwt-signer.js";

const requestId = "123e4567-e89b-42d3-a456-426614174004";

/**
 * 고정 사용자·세션·권한과 JSON 본문으로 내부 쓰기 요청 사례를 만듭니다.
 * @param body 실제 서명·전송 일치 여부를 시험할 본문 바이트.
 * @returns POST 방식의 위임 요청 객체.
 */
function mutationRequest(body = new TextEncoder().encode('{"amountKrw":"12000"}')): DelegatedApiRequest {
  return {
    body,
    contentType: "application/json",
    method: "POST",
    scope: "transaction:write",
    sessionId: "123e4567-e89b-12d3-a456-426614174002",
    target: "/v1/test-mutation",
    userId: "123e4567-e89b-12d3-a456-426614174001",
  };
}

/**
 * 서명·fetch 기록 대역을 실제 위임 클라이언트에 연결해 외부 통신 없이 요청을 검사합니다.
 * @param baseUrl 검증을 시험할 내부 API 기본 URL.
 * @returns 클라이언트·서명기·fetch 대역.
 */
function setup(baseUrl = new URL("https://api.example.test")) {
  const signer = {
    /**
     * 서명 입력을 호출 기록에 남기고 고정 요청 ID·토큰을 반환합니다. 실제 서명은 하지 않습니다.
     * @param input 기록할 위임 요청.
     * @returns 고정 요청 ID와 가짜 JWT 쌍.
     */
    sign: vi.fn(async (input: DelegatedSignInput) => {
      void input;
      return {
        requestId,
        token: "delegated-token",
      };
    }),
  };
  /**
   * URL과 전송 설정을 기록하고 빈 200 응답을 반환합니다.
   * @param input 요청 URL 또는 Request.
   * @param init 전송 메서드·본문·헤더 설정.
   * @returns 본문 없는 200 Response.
   */
  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void input;
    void init;
    return new Response(null, { status: 200 });
  });
  const client = new DelegatedApiClient(baseUrl, signer, fetcher as typeof fetch);
  return { client, fetcher, signer };
}

describe("DelegatedApiClient", () => {
  it.each([
    ["POST", "bank-connection:write", "/v1/bank-connections/kftc/complete", 12_000],
    ["POST", "bank-connection:write", "/v1/bank-connections/kftc/start", 3_000],
    ["POST", "transaction:write", "/v1/bank-connections/kftc/complete", 3_000],
  ] as const)("budgets only exact bank completion: %s %s %s", async (method, scope, target, ms) => {
    const { client } = setup(); const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    try { await client.request({ ...mutationRequest(), method, scope, target }); expect(timeout).toHaveBeenCalledWith(ms); }
    finally { timeout.mockRestore(); }
  });
  it("signs and sends the same exact bytes with only server-owned headers", async () => {
    const { client, fetcher, signer } = setup();
    const body = new TextEncoder().encode('{"amountKrw":"12000"}');
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeoutSignal);
    try {
      const response = await client.request(mutationRequest(body));

      expect(signer.sign).toHaveBeenCalledOnce();
      const signedBody = signer.sign.mock.calls[0]![0].body;
      expect(signedBody).not.toBe(body);
      expect(signedBody).toEqual(body);
      expect(fetcher).toHaveBeenCalledOnce();
      const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url).toEqual(new URL("https://api.example.test/v1/test-mutation"));
      expect(init).toEqual({
        method: "POST",
        body: signedBody,
        headers: {
          accept: "application/json",
          authorization: "Bearer delegated-token",
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        signal: timeoutSignal,
        redirect: "error",
        cache: "no-store",
      });
      expect(init.body).toBe(signedBody);
      expect(timeout).toHaveBeenCalledOnce();
      expect(timeout).toHaveBeenCalledWith(3_000);
      expect(response.status).toBe(200);
    } finally {
      timeout.mockRestore();
    }
  });

  it("snapshots caller-owned bytes before awaiting the signer", async () => {
    const body = new TextEncoder().encode('{"amountKrw":"12000"}');
    const expected = Uint8Array.from(body);
    let releaseSigning: ((value: Readonly<{ requestId: string; token: string }>) => void) | undefined;
    const signer = {
      /**
       * 서명 입력을 기록하고 테스트가 releaseSigning으로 결과를 주기 전까지 기다려 본문 변경 경합을 재현합니다.
       * @param input 서명 시점에 관찰할 요청.
       * @returns 외부에서 해제할 때 완료되는 서명 결과 Promise.
       */
      sign: vi.fn((input: DelegatedSignInput) => {
        void input;
        return new Promise<Readonly<{ requestId: string; token: string }>>((resolve) => {
          releaseSigning = resolve;
        });
      }),
    };
    /**
     * 서명 대기 중 본문이 바뀐 사례에서 실제 전송 인자를 기록하는 fetch 대역입니다.
     * @param input 요청 URL 또는 Request.
     * @param init 기록할 전송 설정.
     * @returns 본문 없는 200 Response.
     */
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 200 });
    });
    const client = new DelegatedApiClient(
      new URL("https://api.example.test"),
      signer,
      fetcher as typeof fetch,
    );

    const pending = client.request(mutationRequest(body));
    expect(signer.sign).toHaveBeenCalledOnce();
    const signedBody = signer.sign.mock.calls[0]![0].body;
    body.fill(0);
    expect(releaseSigning).toBeTypeOf("function");
    releaseSigning!({ requestId, token: "delegated-token" });
    await pending;

    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(signedBody).not.toBe(body);
    expect(signedBody).toEqual(expected);
    expect(init.body).toBe(signedBody);
  });

  it("sends a GET with exactly three server-owned headers and no body or content type", async () => {
    const { client, fetcher, signer } = setup();
    const body = new Uint8Array();
    const timeoutSignal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(timeoutSignal);
    try {
      await client.request({
        body,
        contentType: null,
        method: "GET",
        scope: "me:read",
        sessionId: "123e4567-e89b-12d3-a456-426614174002",
        target: "/v1/me",
        userId: "123e4567-e89b-12d3-a456-426614174001",
      });

      const signedBody = signer.sign.mock.calls[0]![0].body;
      expect(signedBody).not.toBe(body);
      expect(signedBody).toEqual(body);
      const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url).toEqual(new URL("https://api.example.test/v1/me"));
      expect(init).toEqual({
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer delegated-token",
          "x-request-id": requestId,
        },
        signal: timeoutSignal,
        redirect: "error",
        cache: "no-store",
      });
      expect(Object.hasOwn(init, "body")).toBe(false);
      expect(new Headers(init.headers).has("content-type")).toBe(false);
    } finally {
      timeout.mockRestore();
    }
  });

  it("does not expose browser credential or routing fields in its request interface", () => {
    type ForbiddenCredentialKeys = Extract<
      keyof DelegatedApiRequest,
      "authorization" | "cookie" | "headers" | "host" | "requestId"
    >;
    expectTypeOf<ForbiddenCredentialKeys>().toEqualTypeOf<never>();
  });

  it.each([
    ["a GET body", { ...mutationRequest(), body: new Uint8Array([1]), contentType: null, method: "GET" }],
    ["a GET content type", { ...mutationRequest(new Uint8Array()), contentType: "application/json", method: "GET" }],
    ["a mutation without content type", { ...mutationRequest(), contentType: null }],
    ["an empty mutation body", mutationRequest(new Uint8Array())],
    ["an absolute target", { ...mutationRequest(), target: "https://evil.example.test/v1/mutation" }],
    ["a scheme-relative target", { ...mutationRequest(), target: "//user:pass@evil.example.test/v1/mutation" }],
    ["a target fragment", { ...mutationRequest(), target: "/v1/mutation#delegated-token" }],
    ["an empty target fragment", { ...mutationRequest(), target: "/v1/mutation#" }],
    ["an unsupported method", { ...mutationRequest(), method: "PUT" }],
  ])("rejects %s before signing or fetching", async (_name, input) => {
    const { client, fetcher, signer } = setup();

    await expect(client.request(input as unknown as DelegatedApiRequest))
      .rejects.toThrow(/^DELEGATED_API_REQUEST_INVALID$/u);
    expect(signer.sign).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "https://user:pass@api.example.test",
    "https://api.example.test/base",
    "https://api.example.test?query=1",
    "https://api.example.test?",
    "https://api.example.test#fragment",
    "https://api.example.test#",
    "http://api.example.test",
    "ftp://api.example.test",
  ])("rejects an unsafe base URL before constructing a client: %s", (value) => {
    expect(() => setup(new URL(value))).toThrow(/^AUTH_CONFIGURATION_INVALID$/u);
  });

  it.each([
    "https://api.example.test",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
  ])("accepts an HTTPS or explicit loopback root base URL: %s", (value) => {
    expect(() => setup(new URL(value))).not.toThrow();
  });

  it("clones its validated base URL", async () => {
    const baseUrl = new URL("https://api.example.test");
    const { client, fetcher } = setup(baseUrl);
    baseUrl.hostname = "evil.example.test";

    await client.request(mutationRequest());

    expect(fetcher.mock.calls[0]![0]).toEqual(new URL("https://api.example.test/v1/test-mutation"));
  });

  it("collapses signer failures without invoking fetch or exposing the cause", async () => {
    const { client, fetcher, signer } = setup();
    signer.sign.mockRejectedValueOnce(new Error("private-key and delegated claim detail"));

    await expect(client.request(mutationRequest()))
      .rejects.toThrow(/^DELEGATED_API_UNAVAILABLE$/u);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    new DOMException("delegated-token timeout detail", "TimeoutError"),
    new Error("private network topology detail"),
  ])("collapses timeout and network failures without exposing the cause", async (failure) => {
    const { client, fetcher } = setup();
    fetcher.mockRejectedValueOnce(failure);

    await expect(client.request(mutationRequest()))
      .rejects.toThrow(/^DELEGATED_API_UNAVAILABLE$/u);
  });
});
