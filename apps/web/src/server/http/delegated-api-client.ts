import type { DelegatedScope } from "@account-book/contracts/internal-api";
import type { DelegatedSignInput } from "../security/delegated-jwt-signer.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

export type DelegatedApiRequest = Readonly<{
  body: Uint8Array;
  contentType: null | "application/json";
  method: "GET" | "POST" | "PATCH" | "DELETE";
  scope: DelegatedScope;
  sessionId: string;
  target: `/${string}`;
  userId: string;
}>;

export type DelegatedJwtSignerPort = Readonly<{
  sign(input: DelegatedSignInput): Promise<Readonly<{ requestId: string; token: string }>>;
}>;

function invalidConfiguration(): never {
  throw new Error("AUTH_CONFIGURATION_INVALID");
}

function invalidRequest(): never {
  throw new Error("DELEGATED_API_REQUEST_INVALID");
}

function unavailable(): never {
  throw new Error("DELEGATED_API_UNAVAILABLE");
}

function validatedBaseUrl(input: URL): URL {
  try {
    if (!(input instanceof URL)) return invalidConfiguration();
    const serialized = input.toString();
    if (serialized.includes("?") || serialized.includes("#")) return invalidConfiguration();
    const baseUrl = new URL(serialized);
    const loopbackHttp = baseUrl.protocol === "http:" && LOOPBACK_HOSTS.has(baseUrl.hostname);
    if (
      !(baseUrl.protocol === "https:" || loopbackHttp) ||
      baseUrl.username !== "" ||
      baseUrl.password !== "" ||
      baseUrl.pathname !== "/" ||
      baseUrl.search !== "" ||
      baseUrl.hash !== ""
    ) {
      return invalidConfiguration();
    }
    return baseUrl;
  } catch {
    return invalidConfiguration();
  }
}

function validatedTarget(input: DelegatedApiRequest, baseUrl: URL): URL {
  try {
    if (
      input === null ||
      typeof input !== "object" ||
      !METHODS.has(input.method) ||
      !(input.body instanceof Uint8Array) ||
      typeof input.target !== "string" ||
      !input.target.startsWith("/") ||
      input.target.startsWith("//") ||
      input.target.includes("#")
    ) {
      return invalidRequest();
    }
    if (input.method === "GET") {
      if (input.body.byteLength !== 0 || input.contentType !== null) return invalidRequest();
    } else if (input.body.byteLength === 0 || input.contentType !== "application/json") {
      return invalidRequest();
    }
    const target = new URL(input.target, baseUrl);
    if (
      target.origin !== baseUrl.origin ||
      target.username !== "" ||
      target.password !== "" ||
      target.hash !== ""
    ) {
      return invalidRequest();
    }
    return target;
  } catch {
    return invalidRequest();
  }
}

/**
 * Signs and sends one already-serialized internal API request without accepting browser-owned headers.
 * The exact body instance is shared with the signer and fetch implementation so the JWT binding cannot drift.
 */
export class DelegatedApiClient {
  private readonly baseUrl: URL;

  public constructor(
    baseUrl: URL,
    private readonly signer: DelegatedJwtSignerPort,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = validatedBaseUrl(baseUrl);
  }

  public async request(input: DelegatedApiRequest): Promise<Response> {
    const target = validatedTarget(input, this.baseUrl);
    try {
      const signed = await this.signer.sign(input);
      const headers: Record<string, string> = {
        accept: "application/json",
        authorization: `Bearer ${signed.token}`,
        "x-request-id": signed.requestId,
      };
      if (input.contentType !== null) headers["content-type"] = input.contentType;
      return await this.fetcher(target, {
        method: input.method,
        headers,
        ...(input.method === "GET" ? {} : { body: input.body as BodyInit }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      return unavailable();
    }
  }
}
