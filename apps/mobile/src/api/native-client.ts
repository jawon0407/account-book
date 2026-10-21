import ky, { type KyInstance } from "ky";
import { z } from "zod";
import {
  ApiErrorSchema,
  NativeAuthResponseSchema,
  NativeSessionSchema,
  NativeSessionTokenSchema,
  NativeSignInInputSchema,
  TransactionListQuerySchema,
  TransactionListResponseSchema,
} from "@account-book/contracts";
import { ClientError } from "./client-error";
import { NativeLedgerClient } from "./native-ledger-client";
import { NativeCollectorClient } from "./native-collector-client";

/** 빌드에 고정한 하나의 서버에만 요청한다. 토큰·origin을 UI에서 임의로 바꿀 수 없다. */
export class NativeClient {
  public readonly origin: string;
  private readonly http: KyInstance;
  public readonly ledger: NativeLedgerClient;
  public readonly collector: NativeCollectorClient;
  /** @param origin HTTPS origin만 허용. @param transport 테스트용 HTTP 경계, 실제 앱은 OS fetch 사용. */
  public constructor(
    origin: string,
    transport: typeof fetch = globalThis.fetch,
  ) {
    try {
      const url = new URL(origin);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error();
      this.origin = url.origin;
    } catch {
      throw new ClientError("CONFIGURATION");
    }
    this.http = ky.create({
      fetch: transport,
      retry: 0,
      timeout: 10_000,
      credentials: "omit",
      redirect: "error",
      throwHttpErrors: false,
    });
    this.ledger = new NativeLedgerClient((path, method, schema, token, body) =>
      this.call(path, method, schema, token, body),
    );
    this.collector = new NativeCollectorClient(
      (path, method, schema, token, body) =>
        this.call(path, method, schema, token, body),
    );
  }
  /** @param input 이메일·비밀번호·설치 UUID. strict 계약으로 검증한 뒤 새 세션을 받는다. */
  public signIn(input: z.input<typeof NativeSignInInputSchema>) {
    const parsed = NativeSignInInputSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(new ClientError("AUTH_INVALID_CREDENTIALS"));
    return this.call(
      "auth/sign-in",
      "POST",
      NativeAuthResponseSchema,
      undefined,
      parsed.data,
    );
  }
  /** @param token 보안 저장소의 opaque 토큰. 서버의 현재 세션 상태를 확인한다. */
  public session(token: string) {
    return this.call("auth/session", "GET", NativeSessionSchema, token);
  }
  /** @param token 현재 토큰. 회전 요청은 재시도하지 않으며 성공 토큰만 교체 저장해야 한다. */
  public refresh(token: string) {
    return this.call(
      "auth/session/refresh",
      "POST",
      NativeAuthResponseSchema,
      token,
      {},
    );
  }
  /** @param token 폐기할 세션. 로컬 정리 여부와 별도로 서버 폐기를 요청한다. */
  public async signOut(token: string): Promise<void> {
    await this.call(
      "auth/sign-out",
      "POST",
      z.object({ signedOut: z.literal(true) }).strict(),
      token,
      {},
    );
  }
  /** @param token 현재 세션. @param cursor 서버가 준 다음 페이지 값, URL로 해석하지 않는다. */
  public transactions(token: string, cursor?: string) {
    const query = TransactionListQuerySchema.safeParse({
      ...(cursor === undefined ? {} : { cursor }),
      limit: 50,
    });
    if (!query.success)
      return Promise.reject(new ClientError("LEDGER_VALIDATION_FAILED"));
    const parameters = new URLSearchParams({
      limit: "50",
      ...(cursor === undefined ? {} : { cursor }),
    });
    return this.call(
      `transactions?${parameters.toString()}`,
      "GET",
      TransactionListResponseSchema,
      token,
    );
  }
  /** 고정 경로 소비자 전용. 외부 응답은 최대 1MiB·JSON·공유 schema를 통과해야 한다. */
  private async call<T>(
    path: string,
    method: "GET" | "POST" | "PATCH",
    schema: z.ZodType<T>,
    token?: string,
    body?: unknown,
  ): Promise<T> {
    if (
      token !== undefined &&
      !NativeSessionTokenSchema.safeParse(token).success
    )
      throw new ClientError("AUTH_SESSION_EXPIRED");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ClientError("NETWORK"));
      }, 10_000);
    });
    try {
      return await Promise.race([
        this.perform(path, method, schema, controller.signal, token, body),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  /** 헤더와 본문 읽기를 같은 AbortSignal에 묶는다. timeout은 외부 call이 전체에 적용한다. */
  private async perform<T>(
    path: string,
    method: "GET" | "POST" | "PATCH",
    schema: z.ZodType<T>,
    signal: AbortSignal,
    token?: string,
    body?: unknown,
  ): Promise<T> {
    try {
      const response = await this.http(`${this.origin}/api/native/${path}`, {
        method,
        signal,
        headers: {
          accept: "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        ...(body === undefined ? {} : { json: body }),
      });
      if (
        response.redirected ||
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("application/json")
      )
        throw new ClientError("INVALID_RESPONSE");
      const length = Number(response.headers.get("content-length") ?? 0);
      if (!Number.isFinite(length) || length > 1_048_576)
        throw new ClientError("INVALID_RESPONSE");
      const text = await response.text();
      if (text.length > 1_048_576) throw new ClientError("INVALID_RESPONSE");
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new ClientError("INVALID_RESPONSE");
      }
      if (!response.ok) {
        const error = ApiErrorSchema.safeParse(value);
        throw new ClientError(
          error.success ? error.data.code : "UNAVAILABLE",
          response.status,
        );
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) throw new ClientError("INVALID_RESPONSE");
      return parsed.data;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError("NETWORK");
    }
  }
}
