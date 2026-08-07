# 01 — Domain foundation & seed data

**What to build:** the fixed category taxonomy and a per-`resourceId` transaction store, lazily seeded on first read, so every later step has real data to work against.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `CATEGORIES` and `CategorySchema` exist as the single source of truth (10 fixed categories including Groceries, Dining, Shopping, Income, Other)
- [x] A LibSQL-backed transactions table exists (idempotent create), storing `id, resourceId, date, merchant, amount, category, seedCategory`
- [x] `listTransactions(resourceId)`, `addTransaction(...)`, and `seedIfEmpty(resourceId)` are implemented
- [x] Seeding is lazy and scoped per `resourceId` — a fresh `resourceId` gets ~28 seeded transactions across the trailing 30 days on first read
- [x] Seed data spans most categories, with Dining and Shopping deliberately heavy so the first Monthly Review (ticket 04) has something to flag
- [x] `seedCategory` carries the ground-truth label used later only by the Categorizer accuracy scorer (ticket 07) — not surfaced anywhere else
- [x] Verified: querying `listTransactions` for two different `resourceId`s returns two independently-seeded transaction sets (`src/db/transactions.test.ts`)
