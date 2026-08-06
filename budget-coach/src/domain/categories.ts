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
  "Income",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CategorySchema = z.enum(CATEGORIES);
