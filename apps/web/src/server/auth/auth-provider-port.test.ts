import { readFile } from "node:fs/promises";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const module = await import("./auth-provider-port.js").catch(() => ({} as Record<string, unknown>));

it("exports the server-only provider error boundary", () => {
  expect(module.AuthProviderError).toBeTypeOf("function");
});

it("marks the token-bearing provider port as server-only", async () => {
  const source = await readFile(new URL("./auth-provider-port.ts", import.meta.url), "utf8");
  expect(source.startsWith('import "server-only";')).toBe(true);
});

/**
 * 소스에서 지정 메서드 선언 바로 앞의 JSDoc 위치를 확인하고 그 주석을 잘라냅니다.
 * @param source 검사할 TypeScript 소스 문자열.
 * @param signature 찾을 메서드 선언 접두사.
 * @returns 해당 선언의 JSDoc 문자열.
 * @throws 선언 또는 바로 앞 주석이 없으면 검증 실패.
 */
function documentationBefore(source: string, signature: string): string {
  const signatureIndex = source.indexOf(signature);
  expect(signatureIndex).toBeGreaterThan(-1);
  const start = source.lastIndexOf("/**", signatureIndex);
  const end = source.indexOf("*/", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBe(signatureIndex - 3);
  return source.slice(start, end + 2);
}

it("documents every exported provider-port operation with inputs, result, and fixed failures", async () => {
  const source = await readFile(new URL("./auth-provider-port.ts", import.meta.url), "utf8");
  for (const method of ["signUp", "signInWithPassword", "confirmEmail", "startOAuth", "exchangeOAuthCode", "refresh", "signOut", "requestPasswordReset", "exchangeRecoveryCode", "updatePassword"]) {
    const documentation = documentationBefore(source, `  ${method}(`);
    expect(documentation).toContain("@param");
    expect(documentation).toContain("@returns");
    expect(documentation).toContain("@throws");
  }
});

it("documents every public Supabase security operation with inputs, result, and fixed failures", async () => {
  const source = await readFile(new URL("./supabase-auth-adapter.ts", import.meta.url), "utf8");
  for (const method of ["signUp", "signInWithPassword", "confirmEmail", "startOAuth", "exchangeOAuthCode", "refresh", "signOut", "requestPasswordReset", "exchangeRecoveryCode", "updatePassword"]) {
    const documentation = documentationBefore(source, `  public async ${method}(`);
    expect(documentation).toContain("@param");
    expect(documentation).toContain("@returns");
    expect(documentation).toContain("@throws");
  }
});
