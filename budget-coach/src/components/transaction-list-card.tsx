"use client";

import type { Transaction } from "@/db/transactions";
import type { Category } from "@/domain/categories";
import { CATEGORY_COLORS, INCOME_COLOR } from "@/constants/chart-colors";

export const TransactionListCard = ({
  transactions,
  selectedCategory,
}: {
  transactions: Transaction[];
  selectedCategory?: Category;
}) => {
  const visible = selectedCategory
    ? transactions.filter((transaction) => transaction.category === selectedCategory)
    : transactions;

  if (visible.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        {selectedCategory
          ? `No ${selectedCategory} transactions this month.`
          : "No transactions yet."}
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-y-auto -mx-2">
      {visible.slice(0, 30).map((transaction) => {
        const isIncome = transaction.type === "income";
        const dotColor = isIncome ? INCOME_COLOR : CATEGORY_COLORS[transaction.category!];
        return (
          <div
            key={transaction.id}
            className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-sm hover:bg-[var(--secondary)]"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: dotColor }}
              />
              <div className="min-w-0">
                <p className="truncate font-medium">{transaction.merchant}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {transaction.date} · {isIncome ? "Income" : transaction.category}
                </p>
              </div>
            </div>
            <span
              className="shrink-0 font-medium tabular-nums"
              style={isIncome ? { color: INCOME_COLOR } : undefined}
            >
              {isIncome ? "+" : ""}${transaction.amount.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
};
