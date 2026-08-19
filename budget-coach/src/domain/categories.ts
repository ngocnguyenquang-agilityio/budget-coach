import { z } from "zod";

export const CATEGORIES = [
  "Groceries",
  "Dining",
  "Transport",
  "Utilities",
  "Entertainment",
  "Shopping",
  "Housing",
  "Health",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);

// Shared shape for a per-category limit map — not every category need have
// one, hence Partial rather than Record.
export type CategoryLimits = Partial<Record<Category, number>>;
