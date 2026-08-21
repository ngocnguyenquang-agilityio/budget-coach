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

const { addTransaction } = await import("@/db/transactions");
const { dbClient } = await import("@/db/client");
const { listTransactionsTool } = await import("./transactions");
type Category = import("@/domain/categories").Category;

const context = { agent: { resourceId: "resource-filter-test" } };

type ListResult = { transactions: Array<{ merchant: string; date: string }> };

const runList = async (input: { category?: Category; month?: string }): Promise<ListResult> => {
  if (!listTransactionsTool.execute) throw new Error("listTransactionsTool.execute is undefined");
  return (await listTransactionsTool.execute(input, context as never)) as ListResult;
};

describe("listTransactionsTool", () => {
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

  it("returns everything when no filters are given", async () => {
    const result = await runList({});
    expect(result.transactions.length).toBeGreaterThanOrEqual(3);
  });
});
