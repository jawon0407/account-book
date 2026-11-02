import { test, expect } from "@playwright/test";
import { NativeAuthResponseSchema, NativeSessionSchema } from "../../../packages/contracts/src/native-auth.js";

test("Android HTTP login, rotation and logout preserve the PC cookie boundary", async ({ request, page }) => {
  const signedIn = await request.post("/api/native/auth/sign-in", { data: { email: "verified@example.test", password: "correct horse battery staple", deviceId: "11111111-1111-4111-8111-111111111199" } });
  expect(signedIn.status()).toBe(200);
  expect(signedIn.headers()["set-cookie"]).toBeUndefined();
  expect(signedIn.headers()["cache-control"]).toContain("no-store");
  const first = NativeAuthResponseSchema.parse(await signedIn.json());
  const headers = { Authorization: `Bearer ${first.sessionToken}` };
  const current = await request.get("/api/native/auth/session", { headers });
  expect(current.status()).toBe(200);
  expect(NativeSessionSchema.parse(await current.json()).deviceId).toBe("11111111-1111-4111-8111-111111111199");
  const rotated = await request.post("/api/native/auth/session/refresh", { headers, data: {} });
  expect(rotated.status()).toBe(200);
  const second = NativeAuthResponseSchema.parse(await rotated.json());
  expect(second.sessionToken === first.sessionToken).toBe(false);
  expect((await request.get("/api/native/auth/session", { headers })).status()).toBe(401);
  const fresh = { Authorization: `Bearer ${second.sessionToken}` };
  expect((await request.get("/api/native/auth/session", { headers: fresh })).status()).toBe(200);
  // 브라우저가 같은 API를 fetch해도 인증 경로를 섞지 않는다. UI에는 합성 자격 증명을 넣지 않는다.
  await page.goto("/login");
  expect(await page.evaluate(async () => (await fetch("/api/native/auth/session")).status)).toBe(403);
  expect((await request.get("/api/native/auth/session", { headers: { ...fresh, Cookie: "irrelevant=value" } })).status()).toBe(403);
  expect((await request.post("/api/native/auth/sign-out", { headers: fresh, data: {} })).status()).toBe(200);
  expect((await request.get("/api/native/auth/session", { headers: fresh })).status()).toBe(401);
});

test("Android routes reject unsupported methods and enforce a shared email budget", async ({ request }) => {
  expect((await request.get("/api/native/auth/sign-in")).status()).toBe(405);
  expect((await request.fetch("/api/native/auth/sign-in", { method: "OPTIONS" })).status()).toBe(405);
  for (let attempt = 0; attempt < 7; attempt++) {
    const response = await request.post("/api/native/auth/sign-in", { data: { email: "absent-native@example.test", password: "correct horse battery staple", deviceId: "22222222-2222-4222-8222-222222222299" } });
    expect(response.status()).toBe(attempt < 6 ? 401 : 429);
  }
});
