import { describe, expect, it } from "vitest";
import { reconcileBatchCategories } from "./categorize";

// reconcileBatchCategories is the deterministic seam between the (unreliable,
// weak-model) categorizer output and the batch tool's guaranteed-aligned
// result: exactly one entry per input item, in order, degrading a missing or
// malformed entry to expense/"Other" rather than dropping or misaligning it.
describe("reconcileBatchCategories", () => {
  const items = [
    { merchant: "taxi", amount: 12 },
    { merchant: "shopping", amount: 20 },
  ];

  it("passes a fully-aligned result through unchanged", () => {
    const result = reconcileBatchCategories(items, [
      { type: "expense", category: "Transport" },
      { type: "expense", category: "Shopping" },
    ]);
    expect(result).toEqual([
      { type: "expense", category: "Transport" },
      { type: "expense", category: "Shopping" },
    ]);
  });

  it("keeps income entries category-free", () => {
    const result = reconcileBatchCategories([{ merchant: "Employer", amount: 3000 }], [
      { type: "income" },
    ]);
    expect(result).toEqual([{ type: "income" }]);
  });

  it("fills a short array with expense/'Other' for the missing tail items", () => {
    const result = reconcileBatchCategories(items, [{ type: "expense", category: "Transport" }]);
    expect(result).toEqual([
      { type: "expense", category: "Transport" },
      { type: "expense", category: "Other" },
    ]);
  });

  it("degrades a malformed entry (missing type / missing category) to expense/'Other'", () => {
    const result = reconcileBatchCategories(items, [
      { category: "Transport" } as never, // no type
      { type: "expense" }, // expense with no category
    ]);
    expect(result).toEqual([
      { type: "expense", category: "Other" },
      { type: "expense", category: "Other" },
    ]);
  });

  it("degrades to all-'Other' when the model returned nothing at all", () => {
    const result = reconcileBatchCategories(items, undefined);
    expect(result).toEqual([
      { type: "expense", category: "Other" },
      { type: "expense", category: "Other" },
    ]);
  });
});
