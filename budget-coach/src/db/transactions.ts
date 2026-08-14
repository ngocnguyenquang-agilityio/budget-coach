import { dbClient } from "./client";
import type { Category } from "@/domain/categories";
import { SEED_TRANSACTIONS } from "./seed-data";

export interface Transaction {
  id: string;
  resourceId: string;
  date: string;
  merchant: string;
  amount: number;
  category: Category;
  seedCategory: Category | null;
}

export async function createTable(): Promise<void> {
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      resourceId TEXT NOT NULL,
      date TEXT NOT NULL,
      merchant TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      seedCategory TEXT
    )
  `);
}

export async function listTransactions(resourceId: string): Promise<Transaction[]> {
  const result = await dbClient.execute({
    sql: "SELECT id, resourceId, date, merchant, amount, category, seedCategory FROM transactions WHERE resourceId = ? ORDER BY date DESC",
    args: [resourceId],
  });

  return result.rows.map((row) => ({
    id: row.id as string,
    resourceId: row.resourceId as string,
    date: row.date as string,
    merchant: row.merchant as string,
    amount: row.amount as number,
    category: row.category as Category,
    seedCategory: (row.seedCategory as Category | null) ?? null,
  }));
}

export async function addTransaction(
  transaction: Omit<Transaction, "id"> & { id?: string }
): Promise<Transaction> {
  const id = transaction.id ?? crypto.randomUUID();

  await dbClient.execute({
    sql: "INSERT INTO transactions (id, resourceId, date, merchant, amount, category, seedCategory) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      id,
      transaction.resourceId,
      transaction.date,
      transaction.merchant,
      transaction.amount,
      transaction.category,
      transaction.seedCategory,
    ],
  });

  return { ...transaction, id };
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
      sql: "INSERT INTO transactions (id, resourceId, date, merchant, amount, category, seedCategory) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        crypto.randomUUID(),
        resourceId,
        seed.date,
        seed.merchant,
        seed.amount,
        seed.category,
        seed.seedCategory,
      ],
    })),
    "write",
  );
}
