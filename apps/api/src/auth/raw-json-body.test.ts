import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { DELEGATED_JSON_BODY_MAX_BYTES } from "@account-book/contracts/internal-api";
import { registerRawJsonBody } from "./raw-json-body.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function server(): FastifyInstance {
  const instance = Fastify();
  registerRawJsonBody(instance);
  instance.post("/transactions", (request) => ({ body: request.body, rawBody: Array.from(request.rawBody ?? []) }));
  servers.push(instance);
  return instance;
}

describe("registerRawJsonBody", () => {
  it("preserves the exact UTF-8 JSON bytes while parsing the body", async () => {
    const payload = JSON.stringify({ memo: "\uAC00\uACC4\uBD80" });
    const response = await server().inject({
      method: "POST",
      url: "/transactions",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      body: { memo: "\uAC00\uACC4\uBD80" },
      rawBody: Array.from(new TextEncoder().encode(payload)),
    });
  });

  it("rejects a JSON body larger than the delegated body limit", async () => {
    const payload = JSON.stringify({
      memo: "x".repeat(DELEGATED_JSON_BODY_MAX_BYTES + 1 - Buffer.byteLength('{"memo":""}')),
    });
    const response = await server().inject({
      method: "POST",
      url: "/transactions",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(413);
  });

  it("rejects malformed JSON without echoing its raw input", async () => {
    const payload = '{"memo":"private entry"';
    const response = await server().inject({
      method: "POST",
      url: "/transactions",
      headers: { "content-type": "application/json" },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("DELEGATED_REQUEST_INVALID");
    expect(response.body).not.toContain(payload);
  });

  it("rejects an invalid UTF-8 JSON body", async () => {
    const response = await server().inject({
      method: "POST",
      url: "/transactions",
      headers: { "content-type": "application/json" },
      payload: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]),
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("DELEGATED_REQUEST_INVALID");
  });
});
