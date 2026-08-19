import { dbClient } from "./client";
import type { Category } from "@/domain/categories";
import { SEED_TRANSACTIONS } from "./seed-data";

export interface Transaction {
  id: string;
  resourceId: string;
  date: string;
  createdAt: string;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  category: Category | null;
  seedCategory: Category | null;
}

export async function createTable(): Promise<void> {
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      resourceId TEXT NOT NULL,
      date TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      category TEXT,
      seedCategory TEXT
    )
  `);
}

// Ordered by createdAt (when the row was recorded), not `date` (the
// transaction's own, user-editable business date) — two transactions can
// share the same `date` and still need a stable, most-recent-first order.
export async function listTransactions(resourceId: string): Promise<Transaction[]> {
  const result = await dbClient.execute({
    sql: "SELECT id, resourceId, date, createdAt, merchant, amount, type, category, seedCategory FROM transactions WHERE resourceId = ? ORDER BY createdAt DESC",
    args: [resourceId],
  });

  return result.rows.map((row) => ({
    id: row.id as string,
    resourceId: row.resourceId as string,
    date: row.date as string,
    createdAt: row.createdAt as string,
    merchant: row.merchant as string,
    amount: row.amount as number,
    type: row.type as "income" | "expense",
    category: (row.category as Category | null) ?? null,
    seedCategory: (row.seedCategory as Category | null) ?? null,
  }));
}

export async function addTransaction(
  transaction: Omit<Transaction, "id" | "createdAt"> & { id?: string; createdAt?: string }
): Promise<Transaction> {
  const id = transaction.id ?? crypto.randomUUID();
  const createdAt = transaction.createdAt ?? new Date().toISOString();

  await dbClient.execute({
    sql: "INSERT INTO transactions (id, resourceId, date, createdAt, merchant, amount, type, category, seedCategory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      transaction.resourceId,
      transaction.date,
      createdAt,
      transaction.merchant,
      transaction.amount,
      transaction.type,
      transaction.category,
      transaction.seedCategory,
    ],
  });

  return { ...transaction, id, createdAt };
}

export async function seedIfEmpty(resourceId: string): Promise<void> {
  await createTable();

  const existing = await dbClient.execute({
    sql: "SELECT 1 FROM transactions WHERE resourceId = ? LIMIT 1",
    args: [resourceId],
  });

  if (existing.rows.length > 0) return;

  // A single batched statement instead of 28 sequential round-trips — trivial
  // locally, but each new browser's first request would otherwise pay 28
  // network round-trips against a remote Turso database.
  await dbClient.batch(
    SEED_TRANSACTIONS.map((seed) => ({
      sql: "INSERT INTO transactions (id, resourceId, date, createdAt, merchant, amount, type, category, seedCategory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        crypto.randomUUID(),
        resourceId,
        seed.date,
        seed.createdAt,
        seed.merchant,
        seed.amount,
        seed.type,
        seed.category,
        seed.seedCategory,
      ],
    })),
    "write",
  );
}
