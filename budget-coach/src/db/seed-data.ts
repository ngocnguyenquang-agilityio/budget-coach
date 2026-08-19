import type { Category } from "@/domain/categories";

interface SeedTransaction {
  date: string;
  createdAt: string;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  category: Category | null;
  seedCategory: Category | null;
}

// Pins every seed row inside the *current* calendar month, spread across
// days 1..today (clamped to day 1 for offsets beyond today's day-of-month),
// so calendar-month analysis always sees a full, consistent picture
// regardless of what day the app happens to be run on.
const dayInCurrentMonth = (daysAgo: number): string => {
  const today = new Date();
  const day = Math.max(1, today.getDate() - daysAgo);
  const month = String(today.getMonth() + 1).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${String(day).padStart(2, "0")}`;
};

// Unclamped, unlike dayInCurrentMonth — createdAt only needs to preserve the
// SEED array's declared most-recent-first order (the transaction list sorts
// by createdAt), not stay inside the current month.
const createdAtDaysAgo = (daysAgo: number): string =>
  new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

// ~28 transactions spread across the current calendar month, spanning most
// categories. Dining and Shopping are deliberately heavy so the first
// Monthly Review has something to flag as over spend limits.
const SEED: {
  daysAgo: number;
  merchant: string;
  amount: number;
  type: "income" | "expense";
  category: Category | null;
}[] = [
  { daysAgo: 1, merchant: "Trader Joe's", amount: 64.32, type: "expense", category: "Groceries" },
  { daysAgo: 2, merchant: "Whole Foods", amount: 88.1, type: "expense", category: "Groceries" },
  { daysAgo: 3, merchant: "Chipotle", amount: 14.5, type: "expense", category: "Dining" },
  { daysAgo: 3, merchant: "Blue Bottle Coffee", amount: 6.75, type: "expense", category: "Dining" },
  { daysAgo: 4, merchant: "Amazon", amount: 42.99, type: "expense", category: "Shopping" },
  { daysAgo: 5, merchant: "Shell Gas Station", amount: 45.0, type: "expense", category: "Transport" },
  { daysAgo: 5, merchant: "Sushi Nakazawa", amount: 96.4, type: "expense", category: "Dining" },
  { daysAgo: 6, merchant: "PG&E", amount: 110.22, type: "expense", category: "Utilities" },
  { daysAgo: 7, merchant: "Netflix", amount: 15.99, type: "expense", category: "Entertainment" },
  { daysAgo: 7, merchant: "Uber", amount: 22.15, type: "expense", category: "Transport" },
  { daysAgo: 8, merchant: "Target", amount: 73.48, type: "expense", category: "Shopping" },
  { daysAgo: 9, merchant: "Employer Payroll", amount: 3200.0, type: "income", category: null },
  { daysAgo: 9, merchant: "Cheesecake Factory", amount: 58.2, type: "expense", category: "Dining" },
  { daysAgo: 10, merchant: "CVS Pharmacy", amount: 19.99, type: "expense", category: "Health" },
  { daysAgo: 11, merchant: "Rent — Maple Apartments", amount: 1850.0, type: "expense", category: "Housing" },
  { daysAgo: 12, merchant: "Safeway", amount: 51.6, type: "expense", category: "Groceries" },
  { daysAgo: 13, merchant: "Best Buy", amount: 129.99, type: "expense", category: "Shopping" },
  { daysAgo: 13, merchant: "Starbucks", amount: 5.85, type: "expense", category: "Dining" },
  { daysAgo: 14, merchant: "Spotify", amount: 10.99, type: "expense", category: "Entertainment" },
  { daysAgo: 15, merchant: "AMC Theatres", amount: 32.0, type: "expense", category: "Entertainment" },
  { daysAgo: 16, merchant: "Olive Garden", amount: 41.75, type: "expense", category: "Dining" },
  { daysAgo: 17, merchant: "Comcast Xfinity", amount: 79.99, type: "expense", category: "Utilities" },
  { daysAgo: 18, merchant: "Nike.com", amount: 95.0, type: "expense", category: "Shopping" },
  { daysAgo: 19, merchant: "Lyft", amount: 18.4, type: "expense", category: "Transport" },
  { daysAgo: 20, merchant: "Panera Bread", amount: 13.25, type: "expense", category: "Dining" },
  { daysAgo: 22, merchant: "Kaiser Permanente", amount: 35.0, type: "expense", category: "Health" },
  { daysAgo: 24, merchant: "Zara", amount: 84.5, type: "expense", category: "Shopping" },
  { daysAgo: 27, merchant: "Freelance Payment", amount: 450.0, type: "income", category: null },
];

export const SEED_TRANSACTIONS: SeedTransaction[] = SEED.map(({ daysAgo: d, ...rest }) => ({
  ...rest,
  date: dayInCurrentMonth(d),
  createdAt: createdAtDaysAgo(d),
  seedCategory: rest.category,
}));
