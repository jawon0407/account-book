import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { NativeAuthResponseSchema } from "../../../packages/contracts/src/native-auth.js";
import { CollectorStateSchema, type CollectorChangeInput } from "../../../packages/contracts/src/collector.js";

/** @param request 독립적인 HTTP 테스트 context. @param email 합성 계정. @returns 메모리에만 유지할 bearer 헤더. */
async function signIn(request: APIRequestContext, email = "verified@example.test") {
  const response = await request.post("/api/native/auth/sign-in", { data: { email, password: "correct horse battery staple", deviceId: randomUUID() } });
  expect(response.status()).toBe(200);
  return { Authorization: `Bearer ${NativeAuthResponseSchema.parse(await response.json()).sessionToken}` };
}

test("Android collector ownership, rotation and logout flow stays separate from PC", async ({ request, page }) => {
  const a = await signIn(request), b = await signIn(request), other = await signIn(request, "second@example.test");
  /** @param headers 이 테스트의 합성 세션. @returns 검증된 공개 상태; 기기 식별자를 응답하지 않는다. */
  async function state(headers: Record<string, string>) {
    const response = await request.get("/api/native/collector", { headers });
    expect(response.status()).toBe(200); expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    return CollectorStateSchema.parse(await response.json());
  }
  /** @param headers 요청 세션. @param data 엄격한 공개 입력. @param status 기대 상태; mutation 자동 재시도 없음. */
  async function change(headers: Record<string, string>, data: CollectorChangeInput, status = 200) {
    const response = await request.patch("/api/native/collector", { headers, data });
    expect(response.status()).toBe(status); expect(response.headers()["cache-control"]).toContain("no-store");
    return response.json();
  }
  expect(await state(a)).toEqual({ version: 0, state: "inactive" });
  expect(await change(a, { action: "activate", expectedVersion: 0, replaceExisting: false })).toEqual({ version: 1, state: "active_here" });
  expect(await state(b)).toEqual({ version: 1, state: "active_elsewhere" });
  expect(await state(other)).toEqual({ version: 0, state: "inactive" });
  expect(await change(b, { action: "activate", expectedVersion: 1, replaceExisting: false }, 409)).toMatchObject({ code: "COLLECTOR_REPLACE_REQUIRED", retryable: false });
  expect(await change(b, { action: "activate", expectedVersion: 1, replaceExisting: true })).toEqual({ version: 2, state: "active_here" });
  expect(await change(a, { action: "deactivate", expectedVersion: 1 }, 409)).toMatchObject({ code: "COLLECTOR_VERSION_CONFLICT" });
  const refresh = await request.post("/api/native/auth/session/refresh", { headers: b, data: {} });
  expect(refresh.status()).toBe(200);
  const fresh = { Authorization: `Bearer ${NativeAuthResponseSchema.parse(await refresh.json()).sessionToken}` };
  expect((await request.get("/api/native/collector", { headers: b })).status()).toBe(401);
  expect(await state(fresh)).toEqual({ version: 2, state: "active_here" });
  expect((await request.post("/api/native/auth/sign-out", { headers: fresh, data: {} })).status()).toBe(200);
  expect((await request.get("/api/native/collector", { headers: fresh })).status()).toBe(401);
  expect(await state(a)).toEqual({ version: 2, state: "inactive" });
  expect(await change(a, { action: "activate", expectedVersion: 2, replaceExisting: false })).toEqual({ version: 3, state: "active_here" });
  expect(await change(a, { action: "deactivate", expectedVersion: 3 })).toEqual({ version: 4, state: "inactive" });
  expect((await request.patch("/api/native/collector", { headers: a, data: { action: "deactivate", expectedVersion: 4, userId: randomUUID() } })).status()).toBe(400);
  expect((await request.get("/api/native/collector?sessionId=x", { headers: a })).status()).toBe(400);
  expect((await request.post("/api/native/collector", { headers: a, data: {} })).status()).toBe(405);
  await page.goto("/login");
  expect(await page.evaluate(async () => (await fetch("/api/native/collector")).status)).toBe(403);
  expect((await request.get("/api/native/collector", { headers: { ...a, Cookie: "irrelevant=value" } })).status()).toBe(403);
  for (const headers of [a, other]) expect((await request.post("/api/native/auth/sign-out", { headers, data: {} })).status()).toBe(200);
});
