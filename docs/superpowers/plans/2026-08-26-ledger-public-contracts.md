# Ledger Public Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 웹, NestJS API와 향후 Expo 모바일이 공유할 계좌·카테고리·거래 공개 계약을 strict Zod schema와 inferred TypeScript type으로 구현한다.

**Architecture:** packages/contracts에 프레임워크 독립적인 금융 primitive와 도메인별 요청·응답 schema를 추가한다. 생성 명령의 idempotencyKey는 exact JSON body에 포함해 기존 delegated JWT body binding을 그대로 사용하며, DB·API·BFF·UI는 이번 계획에서 변경하지 않는다.

**Tech Stack:** Node.js 22.15.1, pnpm 11.9.0, TypeScript 6.0.3, Zod 4.4.3, Vitest 4.1.10

**Spec:** docs/superpowers/specs/2026-08-26-ledger-public-contracts-design.md

## Global Constraints

- 생성 명령은 JSON body 안의 UUID v4 idempotencyKey를 요구한다.
- 영구 accountId, categoryId, transactionId와 transferId는 서버가 생성한다.
- 사용자 입력 금액은 1 이상 Number.MAX_SAFE_INTEGER 이하의 KRW 정수다.
- 사용자 입력 날짜는 실제 달력에 존재하는 YYYY-MM-DD다.
- 요청 body에서 userId, ownerId, actorId, createdBy와 서버 생성 필드를 거부한다.
- 수정·archive·삭제 명령은 expectedVersion을 요구한다.
- 일반 거래, 이체, 시작 잔액은 서로 다른 명령 계약을 사용한다.
- 계정·카테고리는 archive하고 일반 거래 삭제는 tombstone 응답을 사용한다.
- 모든 object schema는 strict이며 TypeScript type은 z.infer로 생성한다.
- 공개 오류에 SQL, stack, token, cookie, authorization과 거래 memo 원문을 포함하지 않는다.
- packages/contracts의 기존 인증 계약과 ./internal-api subpath를 변경하지 않는다.
- DB, NestJS route, Next.js BFF, React UI, Expo 앱과 새 dependency를 추가하지 않는다.
- export schema와 helper 주석은 행동 원리, 불신 경계, 생성·검증 주체를 설명한다.
- .pnpm-store와 deliverables는 staging하거나 commit하지 않는다.

---

## File Structure

| File | Responsibility |
| --- | --- |
| packages/contracts/src/ledger-common.ts | UUID, 멱등성 키, 금액, 날짜, 시각, 버전, cursor와 page size |
| packages/contracts/src/ledger-common.test.ts | 공통 primitive의 양·음성 경계 |
| packages/contracts/src/accounts.ts | 계정 생성·수정·archive·시작 잔액·응답 |
| packages/contracts/src/accounts.test.ts | 계정 strict input과 response 계약 |
| packages/contracts/src/categories.ts | 카테고리 생성·수정·archive·목록 |
| packages/contracts/src/categories.test.ts | 카테고리 경계와 unknown key 거부 |
| packages/contracts/src/transactions.ts | 일반 거래 CRUD input, transaction union, 이체 생성과 cursor 목록 |
| packages/contracts/src/transactions.test.ts | 거래·이체·union·pagination negative matrix |
| packages/contracts/src/errors.ts | 인증과 금융 공개 오류 code |
| packages/contracts/src/errors.test.ts | 금융 code와 민감 field 거부 |
| packages/contracts/src/index.ts | 공개 schema와 inferred type의 package root export |
| packages/contracts/README.md | 계약 역할과 사용법 |
| docs/guides/full-stack-development-flow.ko.md | contracts-first 흐름과 매개변수 원리 |
| docs/status/2026-08-24-development-progress.ko.md | M2.1 구현 결과와 검증 증거 |
| docs/api/README.md | 예정 ledger route별 request/response contract |

---

### Task 1: Shared Ledger Primitives

**Files:**

- Create: packages/contracts/src/ledger-common.test.ts
- Create: packages/contracts/src/ledger-common.ts

**Interfaces:**

- Consumes: z from Zod 4.4.3.
- Produces: LedgerIdSchema, IdempotencyKeySchema, PositiveKrwAmountSchema, SignedKrwBalanceSchema, LocalDateSchema, TimestampSchema, VersionSchema, ExpectedVersionSchema, CursorSchema, PageSizeSchema and their inferred types.

- [ ] **Step 1: Write the failing primitive tests**

Create packages/contracts/src/ledger-common.test.ts with the following tests:

    import { describe, expect, it } from "vitest";
    import {
      CursorSchema,
      IdempotencyKeySchema,
      LedgerIdSchema,
      LocalDateSchema,
      PageSizeSchema,
      PositiveKrwAmountSchema,
      SignedKrwBalanceSchema,
      TimestampSchema,
      VersionSchema,
    } from "./ledger-common.js";

    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    const uuidV4 = "123e4567-e89b-42d3-a456-426614174000";

    describe("ledger identifiers", () => {
      it("accepts resource UUIDs and requires UUID v4 idempotency keys", () => {
        expect(LedgerIdSchema.parse(uuid)).toBe(uuid);
        expect(IdempotencyKeySchema.parse(uuidV4)).toBe(uuidV4);
        expect(() => IdempotencyKeySchema.parse("123e4567-e89b-72d3-a456-426614174000")).toThrow();
        expect(() => LedgerIdSchema.parse("not-a-uuid")).toThrow();
      });
    });

    describe("ledger numeric boundaries", () => {
      it("accepts exact safe integer boundaries", () => {
        expect(PositiveKrwAmountSchema.parse(1)).toBe(1);
        expect(PositiveKrwAmountSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
        expect(SignedKrwBalanceSchema.parse(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);
        expect(SignedKrwBalanceSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
        expect(VersionSchema.parse(1)).toBe(1);
      });

      it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1000", Number.NaN, Number.POSITIVE_INFINITY])(
        "rejects invalid positive KRW amount %p",
        (value) => expect(() => PositiveKrwAmountSchema.parse(value)).toThrow(),
      );
    });

    describe("ledger dates and paging", () => {
      it("accepts real local dates, UTC timestamps, cursors, and page sizes", () => {
        expect(LocalDateSchema.parse("2028-02-29")).toBe("2028-02-29");
        expect(TimestampSchema.parse("2026-08-26T12:34:56.000Z")).toBe("2026-08-26T12:34:56.000Z");
        expect(CursorSchema.parse("opaque_cursor-1")).toBe("opaque_cursor-1");
        expect(PageSizeSchema.parse(1)).toBe(1);
        expect(PageSizeSchema.parse(100)).toBe(100);
      });

      it.each(["2026-02-29", "2026-13-01", "2026-01-32", "26-01-01"])(
        "rejects invalid local date %s",
        (value) => expect(() => LocalDateSchema.parse(value)).toThrow(),
      );

      it.each([0, 101, 1.5, "10"])("rejects invalid page size %p", (value) => {
        expect(() => PageSizeSchema.parse(value)).toThrow();
      });
    });

- [ ] **Step 2: Run the test and verify RED**

Run:

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/ledger-common.test.ts

Expected: FAIL because ledger-common.js cannot be resolved.

- [ ] **Step 3: Implement the primitive schemas**

Create packages/contracts/src/ledger-common.ts:

    import { z } from "zod";

    /** Identifies a server-created ledger resource; authorization still comes from the authenticated principal. */
    export const LedgerIdSchema = z.uuid();
    export type LedgerId = z.infer<typeof LedgerIdSchema>;

    /**
     * Identifies one client create attempt so retries can return the original result.
     * It is not a credential and must later be scoped by user, operation, and request fingerprint.
     */
    export const IdempotencyKeySchema = z.uuidv4();
    export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

    /** Keeps JSON money exact across web, API, and mobile runtimes while rejecting signs and fractions. */
    export const PositiveKrwAmountSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
    export type PositiveKrwAmount = z.infer<typeof PositiveKrwAmountSchema>;

    /** Represents computed balances, including liabilities, without exceeding exact JavaScript integers. */
    export const SignedKrwBalanceSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
    export type SignedKrwBalance = z.infer<typeof SignedKrwBalanceSchema>;

    /** Preserves the user-selected calendar day without timezone conversion. */
    export const LocalDateSchema = z.iso.date();
    export type LocalDate = z.infer<typeof LocalDateSchema>;

    /** Validates server event timestamps; persistence normalizes accepted offsets to UTC. */
    export const TimestampSchema = z.iso.datetime({ offset: true });
    export type Timestamp = z.infer<typeof TimestampSchema>;

    /** Guards optimistic concurrency with a server-issued positive integer. */
    export const VersionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
    export const ExpectedVersionSchema = VersionSchema;
    export type Version = z.infer<typeof VersionSchema>;

    /** Carries a server-issued cursor that clients store and return without parsing. */
    export const CursorSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/u);
    export type Cursor = z.infer<typeof CursorSchema>;

    /** Bounds one ledger page; the API applies its default when this input is absent. */
    export const PageSizeSchema = z.number().int().min(1).max(100);
    export type PageSize = z.infer<typeof PageSizeSchema>;

- [ ] **Step 4: Run focused tests and typecheck**

Run:

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/ledger-common.test.ts
    corepack pnpm@11.9.0 --filter @account-book/contracts typecheck

Expected: both commands PASS.

- [ ] **Step 5: Commit the primitive boundary**

    git add -- packages/contracts/src/ledger-common.ts packages/contracts/src/ledger-common.test.ts
    git commit -m "feat(contracts): add ledger primitives"

---

### Task 2: Account Contracts

**Files:**

- Create: packages/contracts/src/accounts.test.ts
- Create: packages/contracts/src/accounts.ts

**Interfaces:**

- Consumes: IdempotencyKeySchema, LedgerIdSchema, LocalDateSchema, PositiveKrwAmountSchema, SignedKrwBalanceSchema, TimestampSchema and VersionSchema.
- Produces: AccountKindSchema, OpeningBalanceDirectionSchema, CreateAccountInputSchema, UpdateAccountInputSchema, ArchiveAccountInputSchema, SetOpeningBalanceInputSchema, AccountSchema, AccountListQuerySchema, AccountListResponseSchema and inferred types.

- [ ] **Step 1: Write failing account tests**

Create packages/contracts/src/accounts.test.ts. Use the UUID v4 and timestamp shown below and add these exact expectations:

    import { describe, expect, it } from "vitest";
    import {
      AccountListQuerySchema,
      AccountSchema,
      ArchiveAccountInputSchema,
      CreateAccountInputSchema,
      SetOpeningBalanceInputSchema,
      UpdateAccountInputSchema,
    } from "./accounts.js";

    const id = "123e4567-e89b-42d3-a456-426614174000";
    const idempotencyKey = "223e4567-e89b-42d3-a456-426614174000";
    const timestamp = "2026-08-26T12:34:56.000Z";

    describe("account commands", () => {
      it("accepts minimal create, update, archive, and opening balance inputs", () => {
        expect(CreateAccountInputSchema.parse({ idempotencyKey, kind: "bank", name: "  급여 통장  " })).toEqual({
          idempotencyKey,
          kind: "bank",
          name: "급여 통장",
        });
        expect(UpdateAccountInputSchema.parse({ expectedVersion: 1, name: "생활비" })).toEqual({
          expectedVersion: 1,
          name: "생활비",
        });
        expect(ArchiveAccountInputSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
        expect(SetOpeningBalanceInputSchema.parse({
          accountId: id,
          amountKrw: 500_000,
          direction: "asset",
          idempotencyKey,
          occurredOn: "2026-08-26",
        })).toMatchObject({ accountId: id, amountKrw: 500_000, direction: "asset" });
      });

      it("rejects unknown ownership fields, empty patches, zero amounts, and invalid kinds", () => {
        expect(() => CreateAccountInputSchema.parse({ idempotencyKey, kind: "crypto", name: "코인" })).toThrow();
        expect(() => CreateAccountInputSchema.parse({ idempotencyKey, kind: "cash", name: "현금", userId: id })).toThrow();
        expect(() => UpdateAccountInputSchema.parse({ expectedVersion: 1 })).toThrow();
        expect(() => SetOpeningBalanceInputSchema.parse({
          accountId: id,
          amountKrw: 0,
          direction: "asset",
          idempotencyKey,
          occurredOn: "2026-08-26",
        })).toThrow();
      });
    });

    describe("account responses", () => {
      it("accepts a strict server-owned account response", () => {
        expect(AccountSchema.parse({
          archivedAt: null,
          createdAt: timestamp,
          currentBalanceKrw: -30_000,
          id,
          kind: "card",
          name: "생활 카드",
          updatedAt: timestamp,
          version: 3,
        })).toMatchObject({ currentBalanceKrw: -30_000, id, version: 3 });
      });

      it("rejects response secrets and validates includeArchived as a boolean", () => {
        expect(() => AccountListQuerySchema.parse({ includeArchived: "true" })).toThrow();
        expect(() => AccountSchema.parse({
          archivedAt: null,
          createdAt: timestamp,
          currentBalanceKrw: 0,
          id,
          kind: "cash",
          name: "현금",
          token: "secret",
          updatedAt: timestamp,
          version: 1,
        })).toThrow();
      });
    });

- [ ] **Step 2: Run the test and verify RED**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/accounts.test.ts

Expected: FAIL because accounts.js cannot be resolved.

- [ ] **Step 3: Implement account schemas**

Create packages/contracts/src/accounts.ts with strict schemas. Use AccountNameSchema as z.string().trim().min(1).max(80), AccountKindSchema as z.enum(["cash", "bank", "card"]), and OpeningBalanceDirectionSchema as z.enum(["asset", "liability"]).

The command schemas must have these exact shapes:

    export const CreateAccountInputSchema = z.object({
      idempotencyKey: IdempotencyKeySchema,
      kind: AccountKindSchema,
      name: AccountNameSchema,
    }).strict();

    export const UpdateAccountInputSchema = z.object({
      expectedVersion: ExpectedVersionSchema,
      name: AccountNameSchema.optional(),
    }).strict().refine((input) => input.name !== undefined, {
      message: "ACCOUNT_UPDATE_EMPTY",
    });

    export const ArchiveAccountInputSchema = z.object({
      expectedVersion: ExpectedVersionSchema,
    }).strict();

    export const SetOpeningBalanceInputSchema = z.object({
      accountId: LedgerIdSchema,
      amountKrw: PositiveKrwAmountSchema,
      direction: OpeningBalanceDirectionSchema,
      idempotencyKey: IdempotencyKeySchema,
      occurredOn: LocalDateSchema,
    }).strict();

AccountSchema must be a strict object containing archivedAt as TimestampSchema.nullable(), createdAt, currentBalanceKrw, id, kind, name, updatedAt, and version. AccountListQuerySchema contains optional includeArchived boolean. AccountListResponseSchema is a strict object with items as z.array(AccountSchema). Export z.infer types for every public schema.

Add JSDoc to SetOpeningBalanceInputSchema explaining that direction prevents clients from encoding liabilities with negative amounts.

- [ ] **Step 4: Run focused tests and typecheck**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/ledger-common.test.ts src/accounts.test.ts
    corepack pnpm@11.9.0 --filter @account-book/contracts typecheck

Expected: both commands PASS.

- [ ] **Step 5: Commit account contracts**

    git add -- packages/contracts/src/accounts.ts packages/contracts/src/accounts.test.ts
    git commit -m "feat(contracts): add account contracts"

---

### Task 3: Category Contracts

**Files:**

- Create: packages/contracts/src/categories.test.ts
- Create: packages/contracts/src/categories.ts

**Interfaces:**

- Consumes: ExpectedVersionSchema, IdempotencyKeySchema, LedgerIdSchema, TimestampSchema and VersionSchema.
- Produces: CategoryKindSchema, CreateCategoryInputSchema, UpdateCategoryInputSchema, ArchiveCategoryInputSchema, CategorySchema, CategoryListQuerySchema, CategoryListResponseSchema and inferred types.

- [ ] **Step 1: Write failing category tests**

Create packages/contracts/src/categories.test.ts with tests that prove:

    const id = "123e4567-e89b-42d3-a456-426614174000";
    const idempotencyKey = "223e4567-e89b-42d3-a456-426614174000";

    expect(CreateCategoryInputSchema.parse({
      idempotencyKey,
      kind: "expense",
      name: "  식비  ",
      sortOrder: 10,
    })).toEqual({ idempotencyKey, kind: "expense", name: "식비", sortOrder: 10 });

    expect(UpdateCategoryInputSchema.parse({
      expectedVersion: 2,
      name: "외식",
      sortOrder: 20,
    })).toEqual({ expectedVersion: 2, name: "외식", sortOrder: 20 });

    expect(ArchiveCategoryInputSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
    expect(() => UpdateCategoryInputSchema.parse({ expectedVersion: 2 })).toThrow();
    expect(() => CreateCategoryInputSchema.parse({
      idempotencyKey,
      kind: "transfer",
      name: "이체",
      sortOrder: 0,
    })).toThrow();
    expect(() => CreateCategoryInputSchema.parse({
      idempotencyKey,
      kind: "income",
      name: "급여",
      ownerId: id,
      sortOrder: 0,
    })).toThrow();

Also parse one valid CategorySchema with archivedAt null and reject sortOrder -1, 10_001, fractional values, 51-character names, secret response fields, and string includeArchived.

- [ ] **Step 2: Run the test and verify RED**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/categories.test.ts

Expected: FAIL because categories.js cannot be resolved.

- [ ] **Step 3: Implement category schemas**

Create packages/contracts/src/categories.ts:

    const CategoryNameSchema = z.string().trim().min(1).max(50);
    const CategorySortOrderSchema = z.number().int().min(0).max(10_000);

    export const CategoryKindSchema = z.enum(["income", "expense"]);

    export const CreateCategoryInputSchema = z.object({
      idempotencyKey: IdempotencyKeySchema,
      kind: CategoryKindSchema,
      name: CategoryNameSchema,
      sortOrder: CategorySortOrderSchema,
    }).strict();

    export const UpdateCategoryInputSchema = z.object({
      expectedVersion: ExpectedVersionSchema,
      name: CategoryNameSchema.optional(),
      sortOrder: CategorySortOrderSchema.optional(),
    }).strict().refine(
      (input) => input.name !== undefined || input.sortOrder !== undefined,
      { message: "CATEGORY_UPDATE_EMPTY" },
    );

    export const ArchiveCategoryInputSchema = z.object({
      expectedVersion: ExpectedVersionSchema,
    }).strict();

CategorySchema contains archivedAt, createdAt, id, kind, name, sortOrder, updatedAt, and version. CategoryListQuerySchema has optional includeArchived boolean. CategoryListResponseSchema has items as z.array(CategorySchema). Export all inferred types.

Add a JSDoc note that category kind and transaction kind must later be checked through an ownership-scoped lookup because a UUID alone cannot prove the relationship.

- [ ] **Step 4: Run focused tests and typecheck**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/ledger-common.test.ts src/categories.test.ts
    corepack pnpm@11.9.0 --filter @account-book/contracts typecheck

Expected: both commands PASS.

- [ ] **Step 5: Commit category contracts**

    git add -- packages/contracts/src/categories.ts packages/contracts/src/categories.test.ts
    git commit -m "feat(contracts): add category contracts"

---

### Task 4: Transaction and Transfer Contracts

**Files:**

- Create: packages/contracts/src/transactions.test.ts
- Create: packages/contracts/src/transactions.ts

**Interfaces:**

- Consumes: CursorSchema, ExpectedVersionSchema, IdempotencyKeySchema, LedgerIdSchema, LocalDateSchema, PageSizeSchema, PositiveKrwAmountSchema, TimestampSchema and VersionSchema.
- Produces: CreateTransactionInputSchema, UpdateTransactionInputSchema, DeleteTransactionInputSchema, TransactionSchema, TransactionTombstoneSchema, CreateTransferInputSchema, CreateTransferResultSchema, TransactionListQuerySchema, TransactionListResponseSchema and inferred types.

- [ ] **Step 1: Write failing transaction command tests**

Create packages/contracts/src/transactions.test.ts. Define four UUID v4 fixture values and verify these exact cases:

    expect(CreateTransactionInputSchema.parse({
      accountId,
      amountKrw: 15_000,
      categoryId,
      idempotencyKey,
      memo: "  점심  ",
      occurredOn: "2026-08-26",
      type: "expense",
    })).toMatchObject({ amountKrw: 15_000, memo: "점심", type: "expense" });

    expect(UpdateTransactionInputSchema.parse({
      expectedVersion: 3,
      memo: null,
    })).toEqual({ expectedVersion: 3, memo: null });

    expect(DeleteTransactionInputSchema.parse({ expectedVersion: 3 })).toEqual({ expectedVersion: 3 });
    expect(() => UpdateTransactionInputSchema.parse({ expectedVersion: 3 })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({
      accountId,
      amountKrw: -15_000,
      categoryId,
      idempotencyKey,
      occurredOn: "2026-08-26",
      type: "expense",
    })).toThrow();
    expect(() => CreateTransactionInputSchema.parse({
      accountId,
      amountKrw: 15_000,
      categoryId,
      idempotencyKey,
      occurredOn: "2026-08-26",
      type: "expense",
      userId: accountId,
    })).toThrow();

Verify that an empty string memo, a 501-character memo, unknown type, missing expectedVersion, and fractional amount each fail.

- [ ] **Step 2: Write failing transfer and response-union tests**

In the same file, add tests that:

- accept CreateTransferInputSchema when fromAccountId and toAccountId differ;
- reject identical fromAccountId and toAccountId;
- reject categoryId and ownerId on transfer input;
- accept income/expense responses only with categoryId UUID and transferId null;
- accept transfer_out/transfer_in only with categoryId null and transferId UUID;
- accept opening_balance only with both categoryId and transferId null;
- reject mismatched union combinations;
- accept CreateTransferResultSchema only when debit.kind is transfer_out and credit.kind is transfer_in;
- reject list query where from is lexically after to;
- reject unknown query keys and responses with more than 100 items.

- [ ] **Step 3: Run the test and verify RED**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/transactions.test.ts

Expected: FAIL because transactions.js cannot be resolved.

- [ ] **Step 4: Implement command schemas**

Create packages/contracts/src/transactions.ts. Define:

    const MemoSchema = z.string().trim().min(1).max(500);
    export const TransactionInputTypeSchema = z.enum(["income", "expense"]);

    export const CreateTransactionInputSchema = z.object({
      accountId: LedgerIdSchema,
      amountKrw: PositiveKrwAmountSchema,
      categoryId: LedgerIdSchema,
      idempotencyKey: IdempotencyKeySchema,
      memo: MemoSchema.optional(),
      occurredOn: LocalDateSchema,
      type: TransactionInputTypeSchema,
    }).strict();

    export const UpdateTransactionInputSchema = z.object({
      accountId: LedgerIdSchema.optional(),
      amountKrw: PositiveKrwAmountSchema.optional(),
      categoryId: LedgerIdSchema.optional(),
      expectedVersion: ExpectedVersionSchema,
      memo: MemoSchema.nullable().optional(),
      occurredOn: LocalDateSchema.optional(),
      type: TransactionInputTypeSchema.optional(),
    }).strict().refine((input) =>
      input.accountId !== undefined ||
      input.amountKrw !== undefined ||
      input.categoryId !== undefined ||
      input.memo !== undefined ||
      input.occurredOn !== undefined ||
      input.type !== undefined,
    { message: "TRANSACTION_UPDATE_EMPTY" });

    export const DeleteTransactionInputSchema = z.object({
      expectedVersion: ExpectedVersionSchema,
    }).strict();

    export const CreateTransferInputSchema = z.object({
      amountKrw: PositiveKrwAmountSchema,
      fromAccountId: LedgerIdSchema,
      idempotencyKey: IdempotencyKeySchema,
      memo: MemoSchema.optional(),
      occurredOn: LocalDateSchema,
      toAccountId: LedgerIdSchema,
    }).strict().refine((input) => input.fromAccountId !== input.toAccountId, {
      message: "TRANSFER_ACCOUNTS_MUST_DIFFER",
      path: ["toAccountId"],
    });

Add JSDoc explaining that CreateTransferInputSchema describes one logical command and that the API must create both ledger rows atomically.

- [ ] **Step 5: Implement the strict transaction union**

Define a shared shape with id, accountId, amountKrw, occurredOn, memo as string nullable, version, deletedAt, createdAt and updatedAt.

Create five strict variants:

- income: kind literal income, categoryId LedgerIdSchema, transferId null;
- expense: kind literal expense, categoryId LedgerIdSchema, transferId null;
- transfer_out: kind literal transfer_out, categoryId null, transferId LedgerIdSchema;
- transfer_in: kind literal transfer_in, categoryId null, transferId LedgerIdSchema;
- opening_balance: kind literal opening_balance, categoryId null, transferId null, direction asset 또는 liability.

Export TransactionSchema as z.discriminatedUnion("kind", all five variants).

CreateTransferResultSchema must be:

    export const CreateTransferResultSchema = z.object({
      credit: TransferInTransactionSchema,
      debit: TransferOutTransactionSchema,
      transferId: LedgerIdSchema,
    }).strict();

CreateTransferResultSchema additionally requires debit·credit ids and accountIds to differ, and amountKrw, occurredOn, memo to match. memo is the same nullable command metadata on both persisted rows. TransactionTombstoneSchema must contain id, version and deletedAt. TransactionListQuerySchema contains optional accountId, categoryId, cursor, from, limit, to and type, rejects from > to, and remains strict. TransactionListResponseSchema contains items as z.array(TransactionSchema).max(100) and nextCursor as CursorSchema.nullable().

Export z.infer types for every public schema. Do not export the internal variant helper schemas except TransferInTransactionSchema and TransferOutTransactionSchema required by CreateTransferResultSchema tests.

- [ ] **Step 6: Run focused tests and typecheck**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/ledger-common.test.ts src/accounts.test.ts src/categories.test.ts src/transactions.test.ts
    corepack pnpm@11.9.0 --filter @account-book/contracts typecheck

Expected: all focused tests and typecheck PASS.

- [ ] **Step 7: Commit transaction contracts**

    git add -- packages/contracts/src/transactions.ts packages/contracts/src/transactions.test.ts
    git commit -m "feat(contracts): add transaction contracts"

---

### Task 5: Public Error Codes and Package Exports

**Files:**

- Modify: packages/contracts/src/errors.test.ts
- Modify: packages/contracts/src/errors.ts
- Modify: packages/contracts/src/index.ts

**Interfaces:**

- Consumes: all public schemas from Tasks 1 through 4.
- Produces: ApiErrorCodeSchema, expanded ApiErrorSchema, parseApiError, and package-root exports for public ledger schemas and types.

- [ ] **Step 1: Extend failing error tests**

In packages/contracts/src/errors.test.ts, import ApiErrorCodeSchema and add:

    const ledgerCodes = [
      "LEDGER_VALIDATION_FAILED",
      "LEDGER_NOT_FOUND",
      "LEDGER_VERSION_CONFLICT",
      "LEDGER_IDEMPOTENCY_CONFLICT",
      "LEDGER_ACCOUNT_UNAVAILABLE",
      "LEDGER_CATEGORY_UNAVAILABLE",
      "LEDGER_TRANSFER_INVALID",
    ] as const;

    it("accepts only the approved public ledger error codes", () => {
      for (const code of ledgerCodes) {
        expect(ApiErrorCodeSchema.parse(code)).toBe(code);
        expect(ApiErrorSchema.parse({ ...validError, code })).toMatchObject({ code });
      }
      for (const code of ["LEDGER_SQL_ERROR", "LEDGER_OWNER_MISMATCH", "LEDGER_INTERNAL"]) {
        expect(() => ApiErrorCodeSchema.parse(code)).toThrow();
      }
    });

    it("rejects ledger errors carrying internal or financial fields", () => {
      expect(() => parseApiError({
        ...validError,
        code: "LEDGER_NOT_FOUND",
        memo: "실제 거래 메모",
        sql: "select * from transactions",
        table: "transactions",
      })).toThrow();
    });

- [ ] **Step 2: Run error tests and verify RED**

    corepack pnpm@11.9.0 --filter @account-book/contracts exec vitest run src/errors.test.ts

Expected: FAIL because ApiErrorCodeSchema is not exported and ledger codes are rejected.

- [ ] **Step 3: Implement the shared public error-code schema**

In packages/contracts/src/errors.ts, extract the code enum:

    export const ApiErrorCodeSchema = z.enum([
      "AUTH_INVALID_CREDENTIALS",
      "AUTH_EMAIL_VERIFICATION_REQUIRED",
      "AUTH_SESSION_EXPIRED",
      "AUTH_SESSION_REFRESH_REQUIRED",
      "AUTH_CSRF_REJECTED",
      "AUTH_OAUTH_TRANSACTION_INVALID",
      "AUTH_RATE_LIMITED",
      "AUTH_PROVIDER_UNAVAILABLE",
      "LEDGER_VALIDATION_FAILED",
      "LEDGER_NOT_FOUND",
      "LEDGER_VERSION_CONFLICT",
      "LEDGER_IDEMPOTENCY_CONFLICT",
      "LEDGER_ACCOUNT_UNAVAILABLE",
      "LEDGER_CATEGORY_UNAVAILABLE",
      "LEDGER_TRANSFER_INVALID",
    ]);
    export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

Replace the inline ApiErrorSchema code enum with code: ApiErrorCodeSchema. Keep every other field and parseApiError unchanged.

- [ ] **Step 4: Export all public ledger contracts**

Update packages/contracts/src/index.ts with explicit value and type exports. Do not use export star and do not export internal-api.js from the root.

The value export list is:

- ledger-common.js: LedgerIdSchema, IdempotencyKeySchema, PositiveKrwAmountSchema, SignedKrwBalanceSchema, LocalDateSchema, TimestampSchema, VersionSchema, ExpectedVersionSchema, CursorSchema, PageSizeSchema
- accounts.js: AccountKindSchema, OpeningBalanceDirectionSchema, CreateAccountInputSchema, UpdateAccountInputSchema, ArchiveAccountInputSchema, SetOpeningBalanceInputSchema, AccountSchema, AccountListQuerySchema, AccountListResponseSchema
- categories.js: CategoryKindSchema, CreateCategoryInputSchema, UpdateCategoryInputSchema, ArchiveCategoryInputSchema, CategorySchema, CategoryListQuerySchema, CategoryListResponseSchema
- transactions.js: TransactionInputTypeSchema, CreateTransactionInputSchema, UpdateTransactionInputSchema, DeleteTransactionInputSchema, TransactionSchema, TransactionTombstoneSchema, CreateTransferInputSchema, CreateTransferResultSchema, TransactionListQuerySchema, TransactionListResponseSchema
- errors.js: ApiErrorCodeSchema, ApiErrorSchema, parseApiError

The type export list contains the z.infer type matching each public schema above, excluding ExpectedVersionSchema because it shares Version, plus ApiErrorCode. Keep the existing authentication value and type exports unchanged.

- [ ] **Step 5: Run package tests, typecheck, and build**

    corepack pnpm@11.9.0 --filter @account-book/contracts test
    corepack pnpm@11.9.0 --filter @account-book/contracts typecheck
    corepack pnpm@11.9.0 --filter @account-book/contracts build

Expected: all commands PASS, including existing authentication and internal delegated request tests.

- [ ] **Step 6: Commit errors and exports**

    git add -- packages/contracts/src/errors.ts packages/contracts/src/errors.test.ts packages/contracts/src/index.ts
    git commit -m "feat(contracts): export ledger contracts"

---

### Task 6: Korean Documentation and Full Verification

**Files:**

- Modify: packages/contracts/README.md
- Modify: docs/guides/full-stack-development-flow.ko.md
- Modify: docs/status/2026-08-24-development-progress.ko.md
- Modify: docs/api/README.md

**Interfaces:**

- Consumes: final exported names and observed RED/GREEN command results from Tasks 1 through 5.
- Produces: discoverable Korean usage guidance, accurate progress evidence, and the handoff to the PostgreSQL/RLS plan.

- [ ] **Step 1: Document the package boundary**

Append this section to packages/contracts/README.md:

    ## 금융 공개 계약

    계좌·카테고리·거래 공개 요청과 응답은 package root에서 import한다. 생성 명령의
    idempotencyKey는 재시도 작업 식별자이며 인증 수단이 아니다. 요청 body는 userId를
    받지 않고 API가 검증한 principal에서 사용자를 결정한다.

    - 금액: 양의 KRW safe integer
    - 거래일: 실제 달력의 YYYY-MM-DD
    - 생성: UUID v4 idempotencyKey 필수
    - 수정·삭제: expectedVersion 필수
    - 내부 delegated JWT 계약: @account-book/contracts/internal-api에서만 import

    DB 소유권, category kind 일치, archive 상태, 멱등성 unique와 이체 원자성은 이
    package가 증명하지 않는다. 후속 API·PostgreSQL 계층이 같은 공개 계약을 다시
    검증하고 사용자 범위에서 비즈니스 불변식을 적용한다.

- [ ] **Step 2: Correct and extend the full-stack learning guide**

In docs/guides/full-stack-development-flow.ko.md, replace the existing CreateTransactionInput example so amountKrw is number, IDs are server-created, and idempotencyKey remains in the body:

    type CreateTransactionInput = Readonly<{
      accountId: string;
      amountKrw: number;
      categoryId: string;
      idempotencyKey: string;
      memo?: string;
      occurredOn: string;
      type: "income" | "expense";
    }>;

Immediately below it add:

    amountKrw는 1 이상 Number.MAX_SAFE_INTEGER 이하의 정수다. PostgreSQL BIGINT보다
    공개 JSON 범위를 의도적으로 좁혀 웹·Node·React Native가 같은 값을 정확히
    표현하게 한다. idempotencyKey는 생성 시도 UUID이며 저장된 거래 ID가 아니다.
    transactionId는 성공 시 서버가 생성해 응답한다.

Add a supersession note that the 2026-07-16 PWA offline client-ID flow is not the current M2 runtime model; the approved 2026-07-27 web/native-mobile design uses an online server ledger and server-created permanent IDs.

- [ ] **Step 3: Update API and progress documents**

Replace docs/api/README.md with a concise contract inventory:

    # API Documentation

    ## M2.1 공개 계약

    packages/contracts가 다음 route 계열의 request/response 기준을 소유한다.

    | Route family | 계약 |
    | --- | --- |
    | /v1/accounts | 계정 생성·수정·archive·목록·시작 잔액 |
    | /v1/categories | 카테고리 생성·수정·archive·목록 |
    | /v1/transactions | 수입·지출 생성·수정·삭제·cursor 목록 |
    | /v1/transfers | 원자적 이체 생성 |

    현재 route와 DB 구현은 아직 없다. 다음 계획에서 PostgreSQL/RLS를 먼저 구현한 뒤
    controller를 연결한다. 모든 금융 response는 private, no-store를 사용하고 실제
    오류는 ApiErrorSchema의 안전한 code만 노출한다.

Append a dated M2.1 entry to docs/status/2026-08-24-development-progress.ko.md recording:

- the feature branch and Task 5 implementation commit SHA;
- common/account/category/transaction schema counts;
- focused and full verification commands with observed pass counts;
- DB, API, web, mobile remain unimplemented;
- next plan is PostgreSQL financial schema, roles, grants, RLS, indexes.

Do not write a SHA or pass count until the commands have completed; use the actual values from this branch in the same edit before committing.

- [ ] **Step 4: Run documentation and source checks**

    git diff --check
    corepack pnpm@11.9.0 --filter @account-book/contracts test
    corepack pnpm@11.9.0 --filter @account-book/contracts typecheck
    corepack pnpm@11.9.0 --filter @account-book/contracts build

Expected: all commands PASS.

- [ ] **Step 5: Run the full repository verification**

    corepack pnpm@11.9.0 lint
    corepack pnpm@11.9.0 typecheck
    corepack pnpm@11.9.0 test
    corepack pnpm@11.9.0 build

Expected: all commands PASS. If disposable PostgreSQL or hosted evidence is unavailable, do not weaken tests and record the exact unavailable gate separately; M2.1 itself does not claim hosted readiness.

- [ ] **Step 6: Inspect scope and secret boundaries**

    git status --short
    git diff --check
    git diff --name-only main...HEAD
    git diff main...HEAD -- .gitignore
    git ls-files | rg "(^|/)\.env($|\.)|private.*key|\.pem$"

Expected:

- only files named by this plan are tracked changes;
- .pnpm-store and deliverables remain untracked;
- .gitignore is unchanged;
- no actual env, private key, token, cookie, financial memo, or generated test artifact is staged.

- [ ] **Step 7: Commit documentation with observed evidence**

    git add -- packages/contracts/README.md docs/guides/full-stack-development-flow.ko.md docs/status/2026-08-24-development-progress.ko.md docs/api/README.md
    git commit -m "docs(ledger): document public contracts"

- [ ] **Step 8: Run verification-before-completion**

Invoke superpowers:verification-before-completion and rerun the commands it requires. Record the final HEAD SHA and exact test results. Do not claim M2, database, API, web, mobile, hosted security, or beta readiness.

---

## Plan Self-Review Result

- Spec coverage: common primitives map to Task 1, accounts to Task 2, categories to Task 3, transactions/transfers/cursors to Task 4, public errors and root exports to Task 5, comments/docs/full verification to Task 6.
- Scope control: no database, API, BFF, UI, mobile, dependency, environment, or deployment file is in the plan.
- Type consistency: amountKrw is number throughout; transaction input uses type while response union uses kind; resource IDs are server responses and idempotencyKey is a client UUID v4.
- Security consistency: user identity stays outside public body, body idempotency remains covered by existing exact-body binding, unknown fields fail strict parsing, and internal errors are not public codes.
- Deferred invariant clarity: category ownership/kind, archive state, idempotency uniqueness, optimistic atomic update and transfer rows are explicitly handed to later API/DB plans rather than falsely claimed by Zod.
