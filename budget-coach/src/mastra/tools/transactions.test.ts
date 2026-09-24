import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Same reason as src/db/transactions.test.ts: dbClient reads
// TURSO_DATABASE_URL at import time, so it must be set before the module
// graph (including this tool, which imports src/db/transactions) loads.
const previousDbUrl = process.env.TURSO_DATABASE_URL;
const tmpDir = mkdtempSync(path.join(tmpdir(), "budget-coach-test-"));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;

const { addTransaction, listTransactions } = await import("@/db/transactions");
const { dbClient } = await import("@/db/client");
const { listTransactionsTool, addTransactionsTool, AddTransactionItemSchema } = await import("./transactions");
type Category = import("@/domain/categories").Category;

const context = { agent: { resourceId: "resource-filter-test" } };

type ListResult = { transactions: Array<{ merchant: string; date: string }> };

const runList = async (input: {
  category?: Category;
  month?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
}): Promise<ListResult> => {
  if (!listTransactionsTool.execute) throw new Error("listTransactionsTool.execute is undefined");
  return (await listTransactionsTool.execute(input, context as never)) as ListResult;
};

afterAll(() => {
  dbClient.close();
  if (previousDbUrl === undefined) {
    delete process.env.TURSO_DATABASE_URL;
  } else {
    process.env.TURSO_DATABASE_URL = previousDbUrl;
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

describe("listTransactionsTool", () => {
  it("filters to a single category when given one", async () => {
    await addTransaction({
      resourceId: "resource-filter-test",
      date: "2026-02-10",
      merchant: "Trader Joe's",
      amount: 40,
      type: "expense",
      category: "Groceries",
      seedCategory: null,
    });
    await addTransaction({
      resourceId: "resource-filter-test",
      date: "2026-02-11",
      merchant: "Landlord",
      amount: 1200,
      type: "expense",
      category: "Housing",
      seedCategory: null,
    });

    const result = await runList({ category: "Groceries" });

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].merchant).toBe("Trader Joe's");
  });

  it("filters to a single month when given one", async () => {
    await addTransaction({
      resourceId: "resource-filter-test",
      date: "2026-01-05",
      merchant: "Whole Foods",
      amount: 25,
      type: "expense",
      category: "Groceries",
      seedCategory: null,
    });

    const result = await runList({ category: "Groceries", month: "2026-02" });

    expect(result.transactions.every((t) => t.date.startsWith("2026-02"))).toBe(true);
    expect(result.transactions.some((t) => t.merchant === "Whole Foods")).toBe(false);
  });

  it("filters to a single day when startDate and endDate are the same", async () => {
    const result = await runList({ startDate: "2026-02-10", endDate: "2026-02-10" });

    expect(result.transactions.map((t) => t.merchant)).toEqual(["Trader Joe's"]);
  });

  it("filters to an inclusive date range", async () => {
    const result = await runList({ startDate: "2026-01-05", endDate: "2026-02-10" });

    expect(result.transactions.map((t) => t.merchant).sort()).toEqual(["Trader Joe's", "Whole Foods"]);
  });

  it("filters by a case-insensitive substring of the name", async () => {
    const result = await runList({ search: "trader" });

    expect(result.transactions.map((t) => t.merchant)).toEqual(["Trader Joe's"]);
  });

  it("ignores filler words and matches the rest in any order", async () => {
    const result = await runList({ search: "my new joe's trader transaction" });

    expect(result.transactions.map((t) => t.merchant)).toEqual(["Trader Joe's"]);
  });

  it("finds a transaction by its note when the merchant is a store name", async () => {
    await addTransaction({
      resourceId: "resource-filter-test",
      date: "2026-03-02",
      merchant: "Zara",
      note: "jacket",
      amount: 80,
      type: "expense",
      category: "Shopping",
      seedCategory: null,
    });

    const result = await runList({ search: "my new jacket" });

    expect(result.transactions.map((t) => t.merchant)).toEqual(["Zara"]);
  });

  it("treats LIKE wildcards in the search literally", async () => {
    const result = await runList({ search: "%" });

    expect(result.transactions).toHaveLength(0);
  });

  it("rejects a date that isn't ISO YYYY-MM-DD", async () => {
    const validation = await listTransactionsTool.inputSchema?.["~standard"].validate({ startDate: "18th Sep" });
    expect(validation?.issues).toBeDefined();
  });

  it("returns everything when no filters are given", async () => {
    const result = await runList({});
    expect(result.transactions.length).toBeGreaterThanOrEqual(3);
  });
});

const addBatchContext = { agent: { resourceId: "resource-batch-test" } };

type AddBatchResult = {
  transactions: Array<{ merchant: string; category: Category | null }>;
  incomeDrift?: { declaredIncome: number; currentIncomeTotal: number };
};

const runAddBatch = async (
  transactions: Array<{
    merchant: string;
    amount: number;
    type: "income" | "expense";
    category?: Category;
    date?: string;
  }>
): Promise<AddBatchResult> => {
  if (!addTransactionsTool.execute) throw new Error("addTransactionsTool.execute is undefined");
  return (await addTransactionsTool.execute({ transactions }, addBatchContext as never)) as AddBatchResult;
};

describe("addTransactionsTool", () => {
  it("inserts every transaction in the batch, preserving each item's category", async () => {
    const result = await runAddBatch([
      { merchant: "taxi", amount: 12, type: "expense", category: "Transport" },
      { merchant: "shopping", amount: 20, type: "expense", category: "Shopping" },
    ]);

    expect(result.transactions).toHaveLength(2);

    const stored = await listTransactions("resource-batch-test");
    expect(stored).toHaveLength(2);
    expect(stored.map((t) => t.merchant).sort()).toEqual(["shopping", "taxi"]);
    expect(stored.find((t) => t.merchant === "taxi")?.category).toBe("Transport");
    expect(stored.find((t) => t.merchant === "shopping")?.category).toBe("Shopping");
  });

  it("does not attach incomeDrift when there is no working memory to read (no threadId/mastra)", async () => {
    const result = await runAddBatch([{ merchant: "Employer", amount: 3000, type: "income" }]);
    expect(result.incomeDrift).toBeUndefined();
  });

  it("requires a category for expenses and forbids one for income (per-item schema)", () => {
    expect(
      AddTransactionItemSchema.safeParse({ merchant: "taxi", amount: 12, type: "expense", category: "Transport" }).success
    ).toBe(true);
    expect(AddTransactionItemSchema.safeParse({ merchant: "Employer", amount: 3000, type: "income" }).success).toBe(true);

    expect(AddTransactionItemSchema.safeParse({ merchant: "taxi", amount: 12, type: "expense" }).success).toBe(false);
    expect(
      AddTransactionItemSchema.safeParse({ merchant: "Employer", amount: 3000, type: "income", category: "Other" }).success
    ).toBe(false);
  });
});
