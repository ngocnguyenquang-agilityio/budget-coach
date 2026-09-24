import { describe, expect, it } from "vitest";
import { describeTransactionQuery } from "../describe-transaction-query";

describe("describeTransactionQuery", () => {
  it("names a single day with an ordinal", () => {
    expect(describeTransactionQuery({ startDate: "2026-09-18", endDate: "2026-09-18" }, 4)).toBe(
      "On 18th Sep, you had 4 transactions:"
    );
  });

  it("uses the singular for one transaction", () => {
    expect(describeTransactionQuery({ startDate: "2026-09-01", endDate: "2026-09-01" }, 1)).toBe(
      "On 1st Sep, you had 1 transaction:"
    );
  });

  it("names a date range", () => {
    expect(describeTransactionQuery({ startDate: "2026-09-02", endDate: "2026-09-13" }, 3)).toBe(
      "Between 2nd Sep and 13th Sep, you had 3 transactions:"
    );
  });

  it("names a month and a category", () => {
    expect(describeTransactionQuery({ month: "2026-09", category: "Groceries" }, 2)).toBe(
      "In Sep 2026, you had 2 Groceries transactions:"
    );
  });

  it("names a search term", () => {
    expect(describeTransactionQuery({ search: "jacket" }, 1)).toBe('You had 1 transaction matching "jacket":');
  });

  it("falls back to a plain count with no filters", () => {
    expect(describeTransactionQuery({}, 5)).toBe("You had 5 transactions:");
  });
});
