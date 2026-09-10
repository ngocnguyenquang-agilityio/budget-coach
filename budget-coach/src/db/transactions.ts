import { dbClient } from "./client";
import type { Category } from "@/domain/categories";
import type { TransactionStatus } from "@/domain/transaction";
import { currentPeriod } from "@/domain/period";
import { listSchedules } from "./recurring-schedules";

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
  // ADR-0011. Rows created directly by the user default to "received";
  // rows generated from a Recurring Schedule start "expected".
  status: TransactionStatus;
  // ADR-0012. When set, this Expense was paid out of a Savings Pot: it debits
  // that pot and is excluded from Net Savings.
  fundedByPotId: string | null;
  // Which Recurring Schedule generated this row, so materializing a Period
  // twice can't produce duplicates.
  scheduleId: string | null;
}

const COLUMNS =
  "id, resourceId, date, createdAt, merchant, amount, type, category, seedCategory, status, fundedByPotId, scheduleId";

let ensured: Promise<void> | null = null;

// Idempotent create + migrate. Memoized because every read path calls it and
// the ALTER TABLE probe is a round trip we don't want on each query.
export const createTable = async (): Promise<void> => {
  ensured ??= (async () => {
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
        seedCategory TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        fundedByPotId TEXT,
        scheduleId TEXT
      )
    `);

    // Existing databases predate the ADR-0011/0012 columns. Every row already
    // in the table is money that actually moved, so 'received' is the right
    // backfill — which is also the column default.
    const info = await dbClient.execute("PRAGMA table_info(transactions)");
    const existing = new Set(info.rows.map((row) => row.name as string));
    const additions: [string, string][] = [
      ["status", "TEXT NOT NULL DEFAULT 'received'"],
      ["fundedByPotId", "TEXT"],
      ["scheduleId", "TEXT"],
    ];

    for (const [column, definition] of additions) {
      if (!existing.has(column)) {
        await dbClient.execute(`ALTER TABLE transactions ADD COLUMN ${column} ${definition}`);
      }
    }
  })();

  await ensured;
};

const toTransaction = (row: Record<string, unknown>): Transaction => ({
  id: row.id as string,
  resourceId: row.resourceId as string,
  date: row.date as string,
  createdAt: row.createdAt as string,
  merchant: row.merchant as string,
  amount: row.amount as number,
  type: row.type as "income" | "expense",
  category: (row.category as Category | null) ?? null,
  seedCategory: (row.seedCategory as Category | null) ?? null,
  status: ((row.status as TransactionStatus | null) ?? "received") as TransactionStatus,
  fundedByPotId: (row.fundedByPotId as string | null) ?? null,
  scheduleId: (row.scheduleId as string | null) ?? null,
});

// Generates the `expected` Transactions a Period's Recurring Schedules imply,
// skipping any schedule that already has a row for that Period. Idempotent, so
// it can safely run on every read — which is how it stays impossible to forget
// (ADR-0011).
export const materializeSchedules = async (resourceId: string, period: string): Promise<void> => {
  await createTable();

  const schedules = await listSchedules(resourceId);
  if (schedules.length === 0) return;

  const existing = await dbClient.execute({
    sql: "SELECT scheduleId FROM transactions WHERE resourceId = ? AND substr(date, 1, 7) = ? AND scheduleId IS NOT NULL",
    args: [resourceId, period],
  });
  const already = new Set(existing.rows.map((row) => row.scheduleId as string));

  for (const schedule of schedules) {
    if (already.has(schedule.id)) continue;

    // Clamp to the month's length so a "31st" schedule still lands in February.
    const daysInMonth = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0).getDate();
    const day = Math.min(schedule.dayOfMonth, daysInMonth);

    await addTransaction({
      resourceId,
      merchant: schedule.merchant,
      amount: schedule.amount,
      type: schedule.type,
      category: schedule.category,
      date: `${period}-${String(day).padStart(2, "0")}`,
      seedCategory: null,
      status: "expected",
      fundedByPotId: null,
      scheduleId: schedule.id,
    });
  }
};

// Ordered by createdAt (when the row was recorded), not `date` (the
// transaction's own, user-editable business date) — two transactions can
// share the same `date` and still need a stable, most-recent-first order.
export const listTransactions = async (resourceId: string): Promise<Transaction[]> => {
  await materializeSchedules(resourceId, currentPeriod());

  const result = await dbClient.execute({
    sql: `SELECT ${COLUMNS} FROM transactions WHERE resourceId = ? ORDER BY createdAt DESC`,
    args: [resourceId],
  });

  return result.rows.map((row) => toTransaction(row as unknown as Record<string, unknown>));
};

export const getTransaction = async (resourceId: string, id: string): Promise<Transaction | null> => {
  await createTable();

  const result = await dbClient.execute({
    sql: `SELECT ${COLUMNS} FROM transactions WHERE resourceId = ? AND id = ?`,
    args: [resourceId, id],
  });

  const row = result.rows[0];
  return row ? toTransaction(row as unknown as Record<string, unknown>) : null;
};

export const addTransaction = async (
  transaction: Omit<Transaction, "id" | "createdAt" | "status" | "fundedByPotId" | "scheduleId"> & {
    id?: string;
    createdAt?: string;
    status?: TransactionStatus;
    fundedByPotId?: string | null;
    scheduleId?: string | null;
  }
): Promise<Transaction> => {
  await createTable();

  const id = transaction.id ?? crypto.randomUUID();
  const createdAt = transaction.createdAt ?? new Date().toISOString();
  const status = transaction.status ?? "received";
  const fundedByPotId = transaction.fundedByPotId ?? null;
  const scheduleId = transaction.scheduleId ?? null;

  await dbClient.execute({
    sql: `INSERT INTO transactions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      status,
      fundedByPotId,
      scheduleId,
    ],
  });

  return { ...transaction, id, createdAt, status, fundedByPotId, scheduleId };
};

// Flips an `expected` Transaction to `received`, optionally correcting the
// amount — confirming is also the moment a user says "it was actually $2,900"
// (ADR-0011). Returns null when the id doesn't exist for this resource.
export const confirmTransaction = async (
  resourceId: string,
  id: string,
  amount?: number
): Promise<Transaction | null> => {
  await createTable();

  const existing = await getTransaction(resourceId, id);
  if (!existing) return null;

  const nextAmount = amount ?? existing.amount;
  await dbClient.execute({
    sql: "UPDATE transactions SET status = 'received', amount = ? WHERE resourceId = ? AND id = ?",
    args: [nextAmount, resourceId, id],
  });

  return { ...existing, status: "received", amount: nextAmount };
};

// Period Close drops every Transaction still `expected` in a closed Period
// (ADR-0011): an unconfirmed forecast is not rolled forward and never
// auto-confirms. Returns how many were expired, so the Review can report it.
export const expireExpectedTransactions = async (resourceId: string, period: string): Promise<number> => {
  await createTable();

  const result = await dbClient.execute({
    sql: "DELETE FROM transactions WHERE resourceId = ? AND substr(date, 1, 7) = ? AND status = 'expected'",
    args: [resourceId, period],
  });

  return Number(result.rowsAffected ?? 0);
};
