import { z } from "zod";
import {
  AccountListResponseSchema,
  CategoryListResponseSchema,
  CreateTransactionInputSchema,
  ProfileSchema,
  TransactionSchema,
  UpdateProfileInputSchema,
  type CreateTransactionInput,
  type UpdateProfileInput,
} from "@account-book/contracts";
import { ClientError } from "./client-error";

/** NativeClient가 제공하는 제한된 전송 함수. UI에는 이 함수나 토큰을 전달하지 않는다. */
type LedgerRequest = <T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  schema: z.ZodType<T>,
  token: string,
  body?: unknown,
) => Promise<T>;

/** 프로필·장부 작업만 정의한다. 인증/시간 제한/응답 크기 경계는 NativeClient가 공유한다. */
export class NativeLedgerClient {
  /** @param request 고정 origin의 native HTTP 경계. 임의 URL 요청 기능을 공개하지 않는다. */
  public constructor(private readonly request: LedgerRequest) {}

  /** @param token 현재 앱 세션. 서버가 인증한 본인 프로필을 조회한다. */
  public profile(token: string) {
    return this.request("profile", "GET", ProfileSchema, token);
  }

  /** @param token 현재 세션. @param input 닉네임/거주 기준과 조회 당시 버전. */
  public async updateProfile(token: string, input: UpdateProfileInput) {
    const parsed = UpdateProfileInputSchema.safeParse(input);
    if (!parsed.success) throw new ClientError("PROFILE_VALIDATION_FAILED");
    return this.request("profile", "PATCH", ProfileSchema, token, parsed.data);
  }

  /** @param token 현재 세션. 신규 입력에 사용할 활성 계좌만 요청한다. */
  public accounts(token: string) {
    return this.request("accounts", "GET", AccountListResponseSchema, token);
  }

  /** @param token 현재 세션. 신규 입력에 사용할 활성 카테고리만 요청한다. */
  public categories(token: string) {
    return this.request("categories", "GET", CategoryListResponseSchema, token);
  }

  /** @param token 현재 세션. @param input 시도당 고정 UUID가 포함된 수기 거래. 자동 재시도하지 않는다. */
  public async createTransaction(token: string, input: CreateTransactionInput) {
    const parsed = CreateTransactionInputSchema.safeParse(input);
    if (!parsed.success) throw new ClientError("LEDGER_VALIDATION_FAILED");
    return this.request(
      "transactions",
      "POST",
      TransactionSchema,
      token,
      parsed.data,
    );
  }
}
