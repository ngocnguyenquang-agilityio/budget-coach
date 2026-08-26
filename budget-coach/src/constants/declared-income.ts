// Merchant label stamped on the Income transaction that mirrors the user's
// Declared Income for a Period. Setting Declared Income upserts a single
// transaction carrying this merchant for the current month, so it shows up in
// "Income this month" without stacking duplicates across repeated reviews.
export const DECLARED_INCOME_MERCHANT = "Declared income";
