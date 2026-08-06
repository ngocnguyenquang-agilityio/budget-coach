import type { Category } from "@/domain/categories";

interface SeedTransaction {
  date: string;
  merchant: string;
  amount: number;
  category: Category;
  seedCategory: Category;
}

// Trailing-30-days offsets from "today" at seed time, so the data always
// looks recent regardless of when the app is run.
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ~28 transactions across the trailing 30 days spanning most categories.
// Dining and Shopping are deliberately heavy so the first Monthly Review
// has something to flag as over trailing-spend limits.
const SEED: { daysAgo: number; merchant: string; amount: number; category: Category }[] = [
  { daysAgo: 1, merchant: "Trader Joe's", amount: 64.32, category: "Groceries" },
  { daysAgo: 2, merchant: "Whole Foods", amount: 88.1, category: "Groceries" },
  { daysAgo: 3, merchant: "Chipotle", amount: 14.5, category: "Dining" },
  { daysAgo: 3, merchant: "Blue Bottle Coffee", amount: 6.75, category: "Dining" },
  { daysAgo: 4, merchant: "Amazon", amount: 42.99, category: "Shopping" },
  { daysAgo: 5, merchant: "Shell Gas Station", amount: 45.0, category: "Transport" },
  { daysAgo: 5, merchant: "Sushi Nakazawa", amount: 96.4, category: "Dining" },
  { daysAgo: 6, merchant: "PG&E", amount: 110.22, category: "Utilities" },
  { daysAgo: 7, merchant: "Netflix", amount: 15.99, category: "Entertainment" },
  { daysAgo: 7, merchant: "Uber", amount: 22.15, category: "Transport" },
  { daysAgo: 8, merchant: "Target", amount: 73.48, category: "Shopping" },
  { daysAgo: 9, merchant: "Employer Payroll", amount: 3200.0, category: "Income" },
  { daysAgo: 9, merchant: "Cheesecake Factory", amount: 58.2, category: "Dining" },
  { daysAgo: 10, merchant: "CVS Pharmacy", amount: 19.99, category: "Health" },
  { daysAgo: 11, merchant: "Rent — Maple Apartments", amount: 1850.0, category: "Housing" },
  { daysAgo: 12, merchant: "Safeway", amount: 51.6, category: "Groceries" },
  { daysAgo: 13, merchant: "Best Buy", amount: 129.99, category: "Shopping" },
  { daysAgo: 13, merchant: "Starbucks", amount: 5.85, category: "Dining" },
  { daysAgo: 14, merchant: "Spotify", amount: 10.99, category: "Entertainment" },
  { daysAgo: 15, merchant: "AMC Theatres", amount: 32.0, category: "Entertainment" },
  { daysAgo: 16, merchant: "Olive Garden", amount: 41.75, category: "Dining" },
  { daysAgo: 17, merchant: "Comcast Xfinity", amount: 79.99, category: "Utilities" },
  { daysAgo: 18, merchant: "Nike.com", amount: 95.0, category: "Shopping" },
  { daysAgo: 19, merchant: "Lyft", amount: 18.4, category: "Transport" },
  { daysAgo: 20, merchant: "Panera Bread", amount: 13.25, category: "Dining" },
  { daysAgo: 22, merchant: "Kaiser Permanente", amount: 35.0, category: "Health" },
  { daysAgo: 24, merchant: "Zara", amount: 84.5, category: "Shopping" },
  { daysAgo: 27, merchant: "Freelance Payment", amount: 450.0, category: "Income" },
];

export const SEED_TRANSACTIONS: SeedTransaction[] = SEED.map(({ daysAgo: d, ...rest }) => ({
  ...rest,
  date: daysAgo(d),
  seedCategory: rest.category,
}));
