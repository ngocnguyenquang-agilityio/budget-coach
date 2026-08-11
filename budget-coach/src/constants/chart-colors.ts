import type { Category } from "@/domain/categories";

export const CATEGORY_COLORS: Record<Category, string> = {
  Groceries: "var(--chart-1)",
  Dining: "var(--chart-2)",
  Transport: "var(--chart-3)",
  Utilities: "var(--chart-4)",
  Entertainment: "var(--chart-5)",
  Shopping: "var(--chart-6)",
  Housing: "var(--chart-7)",
  Health: "var(--chart-8)",
  Income: "var(--chart-neutral)",
  Other: "var(--chart-neutral)",
};
