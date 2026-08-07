import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// dbClient is a module-level singleton read from TURSO_DATABASE_URL at import
// time, so the env var must be set before the module graph is evaluated —
// hence the dynamic imports below instead of static ones.
const previousDbUrl = process.env.TURSO_DATABASE_URL;
const tmpDir = mkdtempSync(path.join(tmpdir(), "budget-coach-test-"));
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, "test.db")}`;

const { seedIfEmpty, listTransactions } = await import("./transactions");
const { SEED_TRANSACTIONS } = await import("./seed-data");
const { dbClient } = await import("./client");

describe("seedIfEmpty / listTransactions", () => {
  afterAll(() => {
    dbClient.close();
    if (previousDbUrl === undefined) {
      delete process.env.TURSO_DATABASE_URL;
    } else {
      process.env.TURSO_DATABASE_URL = previousDbUrl;
    }
    // Windows can hold a brief lock on the WAL file after close(); cleanup
    // is best-effort so a lingering lock doesn't fail the suite.
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("seeds ~28 transactions across most categories on first read", async () => {
    await seedIfEmpty("resource-a");
    const transactions = await listTransactions("resource-a");

    expect(transactions).toHaveLength(SEED_TRANSACTIONS.length);
    expect(transactions.every((t) => t.resourceId === "resource-a")).toBe(true);

    const categories = new Set(transactions.map((t) => t.category));
    expect(categories.size).toBeGreaterThanOrEqual(7);
  });

  it("does not re-seed on a second call for the same resourceId", async () => {
    await seedIfEmpty("resource-b");
    await seedIfEmpty("resource-b");
    const transactions = await listTransactions("resource-b");

    expect(transactions).toHaveLength(SEED_TRANSACTIONS.length);
  });

  it("seeds two different resourceIds independently", async () => {
    await seedIfEmpty("resource-c");
    await seedIfEmpty("resource-d");

    const c = await listTransactions("resource-c");
    const d = await listTransactions("resource-d");

    expect(c).toHaveLength(SEED_TRANSACTIONS.length);
    expect(d).toHaveLength(SEED_TRANSACTIONS.length);
    expect(c.every((t) => t.resourceId === "resource-c")).toBe(true);
    expect(d.every((t) => t.resourceId === "resource-d")).toBe(true);
  });
});
