import { Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { DELEGATED_JSON_BODY_MAX_BYTES } from "@account-book/contracts/internal-api";
import { registerRequestBodyParsers } from "../main.js";
import { registerRawJsonBody } from "./raw-json-body.js";

const servers: FastifyInstance[] = [];

class RawJsonBodyLifecycleController {
  public handle(): Readonly<{ status: "ok" }> { return { status: "ok" }; }
}
Controller("lifecycle")(RawJsonBodyLifecycleController);
Post()(RawJsonBodyLifecycleController.prototype, "handle", Object.getOwnPropertyDescriptor(RawJsonBodyLifecycleController.prototype, "handle")!);

class RawJsonBodyLifecycleModule {}
Module({ controllers: [RawJsonBodyLifecycleController] })(RawJsonBodyLifecycleModule);

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
  it("survives Nest initialization and listen while parsing raw JSON once", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      RawJsonBodyLifecycleModule,
      new FastifyAdapter(),
      { logger: false },
    );
    registerRequestBodyParsers(app);
    const parsedRequests: import("fastify").FastifyRequest[] = [];
    app.getHttpAdapter().getInstance().addHook("preHandler", (request, _reply, done) => {
      parsedRequests.push(request);
      done();
    });

    try {
      await app.init();
      await app.listen(0, "127.0.0.1");
      const payload = JSON.stringify({ memo: "\uAC00\uACC4\uBD80" });
      const response = await app.inject({
        method: "POST",
        url: "/lifecycle",
        headers: { "content-type": "application/json" },
        payload,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ status: "ok" });
      expect(parsedRequests[0]?.body).toEqual({ memo: "\uAC00\uACC4\uBD80" });
      expect(parsedRequests[0]?.rawBody).toEqual(new TextEncoder().encode(payload));

      const formResponse = await app.inject({
        method: "POST",
        url: "/lifecycle",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "memo=lunch+note&tag=one&tag=two",
      });

      expect(formResponse.statusCode).toBe(201);
      expect(parsedRequests[1]?.body).toEqual({ memo: "lunch note", tag: ["one", "two"] });
    } finally {
      await app.close();
    }
  });

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
