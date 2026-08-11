"use client";

import type { Transaction } from "@/db/transactions";
import { CATEGORY_COLORS } from "@/constants/chart-colors";

export const TransactionListCard = ({
  transactions,
}: {
  transactions: Transaction[];
}) => {
  if (transactions.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No transactions yet.
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto -mx-2">
      {transactions.slice(0, 30).map((transaction) => (
        <div
          key={transaction.id}
          className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm hover:bg-[var(--secondary)]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[transaction.category] }}
            />
            <div className="min-w-0">
              <p className="truncate font-medium">{transaction.merchant}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {transaction.date} · {transaction.category}
              </p>
            </div>
          </div>
          <span className="shrink-0 font-medium tabular-nums">
            ${transaction.amount.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
};
