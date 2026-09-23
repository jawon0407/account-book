import { describe, expect, it } from "vitest";
import {
  ArchiveCategoryInputSchema,
  CategoryListQuerySchema,
  CategorySchema,
  CreateCategoryInputSchema,
  UpdateCategoryInputSchema,
} from "./categories.js";

const id = "123e4567-e89b-42d3-a456-426614174000";
const idempotencyKey = "223e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-08-26T12:34:56.000Z";

describe("category commands", () => {
  it("normalizes names and accepts create, update, and archive inputs", () => {
    expect(CreateCategoryInputSchema.parse({ idempotencyKey, kind: "expense", name: "  식비  ", sortOrder: 10 }))
      .toEqual({ idempotencyKey, kind: "expense", name: "식비", sortOrder: 10 });
    expect(UpdateCategoryInputSchema.parse({ expectedVersion: 2, name: "외식", sortOrder: 20 }))
      .toEqual({ expectedVersion: 2, name: "외식", sortOrder: 20 });
    expect(ArchiveCategoryInputSchema.parse({ expectedVersion: 2 })).toEqual({ expectedVersion: 2 });
  });

  it("rejects empty updates, transfer kinds, and client ownership fields", () => {
    expect(() => UpdateCategoryInputSchema.parse({ expectedVersion: 2 })).toThrow();
    expect(() => CreateCategoryInputSchema.parse({ idempotencyKey, kind: "transfer", name: "이체", sortOrder: 0 })).toThrow();
    expect(() => CreateCategoryInputSchema.parse({ idempotencyKey, kind: "income", name: "급여", ownerId: id, sortOrder: 0 })).toThrow();
  });
});

describe("category responses", () => {
  it("accepts a strict category response", () => {
    expect(CategorySchema.parse({ archivedAt: null, createdAt: timestamp, id, kind: "income", name: "급여", sortOrder: 0, updatedAt: timestamp, version: 1 }))
      .toMatchObject({ id, kind: "income", sortOrder: 0, version: 1 });
  });

  it("enforces sort order, name, response, and query boundaries", () => {
    for (const sortOrder of [-1, 10_001, 1.5]) {
      expect(() => CreateCategoryInputSchema.parse({ idempotencyKey, kind: "expense", name: "식비", sortOrder })).toThrow();
    }
    expect(() => CreateCategoryInputSchema.parse({ idempotencyKey, kind: "expense", name: "가".repeat(51), sortOrder: 0 })).toThrow();
    expect(() => CategorySchema.parse({ archivedAt: null, createdAt: timestamp, id, kind: "expense", name: "식비", sortOrder: 0, updatedAt: timestamp, version: 1, token: "secret" })).toThrow();
    expect(() => CategoryListQuerySchema.parse({ includeArchived: "true" })).toThrow();
  });
});
