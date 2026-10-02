import {
  ProfileSchema, UpdateProfileInputSchema,
  AccountSchema, AccountListResponseSchema, CreateAccountInputSchema, UpdateAccountInputSchema, ArchiveAccountInputSchema,
  CategorySchema, CategoryListResponseSchema, CreateCategoryInputSchema, UpdateCategoryInputSchema, ArchiveCategoryInputSchema,
  LedgerIdSchema,
  TransactionSchema, TransactionListResponseSchema, CreateTransactionInputSchema, UpdateTransactionInputSchema, DeleteTransactionInputSchema, TransactionTombstoneSchema,
} from "@account-book/contracts";
import type { DelegatedScope } from "@account-book/contracts/internal-api";
import type { z } from "zod";
import { CoreBoundaryError } from "./http-boundary.js";
import { transactionTarget } from "./transaction-target.js";

type Operation = Readonly<{
  method: "GET" | "POST" | "PATCH" | "DELETE";
  scope: DelegatedScope;
  path: "/v1/profile" | "/v1/accounts" | "/v1/categories" | "/v1/transactions";
  item?: true;
  archive?: true;
  list?: true;
  input?: z.ZodType;
  output: z.ZodType;
  status: 200 | 201;
}>;

/** 코드가 선택하는 닫힌 작업 표. 브라우저는 내부 주소·scope·응답 계약을 지정할 수 없다. */
const operations = {
  transactionsUpdate: { method: "PATCH", scope: "transaction:write", path: "/v1/transactions", item: true, input: UpdateTransactionInputSchema, output: TransactionSchema, status: 200 },
  transactionsDelete: { method: "DELETE", scope: "transaction:write", path: "/v1/transactions", item: true, input: DeleteTransactionInputSchema, output: TransactionTombstoneSchema, status: 200 },
  transactionsList: { method: "GET", scope: "transaction:read", path: "/v1/transactions", list: true, output: TransactionListResponseSchema, status: 200 },
  transactionsCreate: { method: "POST", scope: "transaction:write", path: "/v1/transactions", input: CreateTransactionInputSchema, output: TransactionSchema, status: 201 },
  profileGet: { method: "GET", scope: "profile:read", path: "/v1/profile", output: ProfileSchema, status: 200 },
  profileUpdate: { method: "PATCH", scope: "profile:write", path: "/v1/profile", input: UpdateProfileInputSchema, output: ProfileSchema, status: 200 },
  accountsList: { method: "GET", scope: "account:read", path: "/v1/accounts", list: true, output: AccountListResponseSchema, status: 200 },
  accountsCreate: { method: "POST", scope: "account:write", path: "/v1/accounts", input: CreateAccountInputSchema, output: AccountSchema, status: 201 },
  accountsUpdate: { method: "PATCH", scope: "account:write", path: "/v1/accounts", item: true, input: UpdateAccountInputSchema, output: AccountSchema, status: 200 },
  accountsArchive: { method: "POST", scope: "account:write", path: "/v1/accounts", item: true, archive: true, input: ArchiveAccountInputSchema, output: AccountSchema, status: 200 },
  categoriesList: { method: "GET", scope: "category:read", path: "/v1/categories", list: true, output: CategoryListResponseSchema, status: 200 },
  categoriesCreate: { method: "POST", scope: "category:write", path: "/v1/categories", input: CreateCategoryInputSchema, output: CategorySchema, status: 201 },
  categoriesUpdate: { method: "PATCH", scope: "category:write", path: "/v1/categories", item: true, input: UpdateCategoryInputSchema, output: CategorySchema, status: 200 },
  categoriesArchive: { method: "POST", scope: "category:write", path: "/v1/categories", item: true, archive: true, input: ArchiveCategoryInputSchema, output: CategorySchema, status: 200 },
} as const satisfies Record<string, Operation>;

export type CoreOperation = keyof typeof operations;

/** @param name 라우트 파일에 고정한 작업명. @returns 상속 프로퍼티를 제외한 허용 작업만 반환한다. */
export function operationFor(name: string): Operation {
  if (!Object.hasOwn(operations, name)) throw new CoreBoundaryError("LEDGER_VALIDATION_FAILED", 400);
  return operations[name as CoreOperation];
}

/** @param operation 선택된 고정 작업. @returns 해당 도메인의 입력 거부 오류. */
export function invalidInput(operation: Operation): CoreBoundaryError {
  return new CoreBoundaryError(operation.path === "/v1/profile" ? "PROFILE_VALIDATION_FAILED" : "LEDGER_VALIDATION_FAILED", 400);
}

/**
 * UUID/쿼리만 검증하여 고정 내부 경로에 붙인다. 알 수 없는·중복 query와 우회 경로는 거부한다.
 * @param operation 코드가 선택한 작업. @param url 브라우저 요청 URL. @param parameters Next 경로 매개변수.
 */
export function targetFor(operation: Operation, url: URL, parameters: Readonly<Record<string, string>>): `/${string}` {
  let target: `/${string}` = operation.path;
  if (Object.keys(parameters).length !== (operation.item ? 1 : 0)) throw invalidInput(operation);
  if (operation.item) {
    const parsed = LedgerIdSchema.safeParse(parameters.id);
    if (!parsed.success) throw invalidInput(operation);
    target = `${target}/${parsed.data}${operation.archive ? "/archive" : ""}`;
  }
  const browserPath = operation.path.replace(/^\/v1\//u, "/api/") + (operation.item ? `/${parameters.id}${operation.archive ? "/archive" : ""}` : "");
  if (url.pathname !== browserPath) throw invalidInput(operation);
  if (operation.path === "/v1/transactions" && operation.list) return transactionTarget(url.searchParams);
  const query = [...url.searchParams.entries()];
  if (query.length > 0) {
    if (!operation.list || query.length !== 1 || query[0]![0] !== "includeArchived" || !["true", "false"].includes(query[0]![1])) throw invalidInput(operation);
    target = `${target}?includeArchived=${query[0]![1]}`;
  }
  return target;
}
