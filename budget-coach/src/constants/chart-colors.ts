import type { Category } from "@/domain/categories";

export const CATEGORY_COLORS: Record<Category, string> = {
  Groceries: "var(--budget-chart-1)",
  Dining: "var(--budget-chart-2)",
  Transport: "var(--budget-chart-3)",
  Utilities: "var(--budget-chart-4)",
  Entertainment: "var(--budget-chart-5)",
  Shopping: "var(--budget-chart-6)",
  Housing: "var(--budget-chart-7)",
  Health: "var(--budget-chart-8)",
  Other: "var(--budget-chart-neutral)",
};

export const INCOME_COLOR = "var(--budget-chart-positive)";

export const TRANSFER_COLOR = "var(--budget-chart-neutral)";
