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
