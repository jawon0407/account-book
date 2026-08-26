import { z } from "zod";
import {
  ExpectedVersionSchema,
  IdempotencyKeySchema,
  LedgerIdSchema,
  TimestampSchema,
  VersionSchema,
} from "./ledger-common.js";

export const CategoryNameSchema = z.string().trim().min(1).max(50);
export type CategoryName = z.infer<typeof CategoryNameSchema>;

export const CategorySortOrderSchema = z.number().int().min(0).max(10_000);
export type CategorySortOrder = z.infer<typeof CategorySortOrderSchema>;

export const CategoryKindSchema = z.enum(["income", "expense"]);
export type CategoryKind = z.infer<typeof CategoryKindSchema>;

export const CreateCategoryInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  kind: CategoryKindSchema,
  name: CategoryNameSchema,
  sortOrder: CategorySortOrderSchema,
}).strict();
export type CreateCategoryInput = z.infer<typeof CreateCategoryInputSchema>;

export const UpdateCategoryInputSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
  name: CategoryNameSchema.optional(),
  sortOrder: CategorySortOrderSchema.optional(),
}).strict().refine(
  (input) => input.name !== undefined || input.sortOrder !== undefined,
  { message: "CATEGORY_UPDATE_EMPTY" },
);
export type UpdateCategoryInput = z.infer<typeof UpdateCategoryInputSchema>;

export const ArchiveCategoryInputSchema = z.object({
  expectedVersion: ExpectedVersionSchema,
}).strict();
export type ArchiveCategoryInput = z.infer<typeof ArchiveCategoryInputSchema>;

/** A UUID alone cannot prove ownership; category and transaction kinds require an ownership-scoped lookup. */
export const CategorySchema = z.object({
  archivedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  id: LedgerIdSchema,
  kind: CategoryKindSchema,
  name: CategoryNameSchema,
  sortOrder: CategorySortOrderSchema,
  updatedAt: TimestampSchema,
  version: VersionSchema,
}).strict();
export type Category = z.infer<typeof CategorySchema>;

export const CategoryListQuerySchema = z.object({
  includeArchived: z.boolean().optional(),
}).strict();
export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;

export const CategoryListResponseSchema = z.object({
  items: z.array(CategorySchema),
}).strict();
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;
