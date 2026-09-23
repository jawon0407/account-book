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

/**
 * 이름 또는 정렬 순서가 실제로 제공된 수정 요청만 허용한다. 두 값 모두 없으면 refine이 거부한다.
 * sortOrder가 0이면 유효한 변경값이며 undefined와 구분한다. DB 버전 비교는 여기서 하지 않는다.
 */
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

/** 응답 모양만 검사한다. UUID만으로 소유권을 증명할 수 없어 향후 API가 사용자별 조회와 종류 일치를 확인해야 한다. */
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
