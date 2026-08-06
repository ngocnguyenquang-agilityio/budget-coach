# 01 — Domain foundation & seed data

**What to build:** the fixed category taxonomy and a per-`resourceId` transaction store, lazily seeded on first read, so every later step has real data to work against.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `CATEGORIES` and `CategorySchema` exist as the single source of truth (10 fixed categories including Groceries, Dining, Shopping, Income, Other)
- [ ] A LibSQL-backed transactions table exists (idempotent create), storing `id, resourceId, date, merchant, amount, category, seedCategory`
- [ ] `listTransactions(resourceId)`, `addTransaction(...)`, and `seedIfEmpty(resourceId)` are implemented
- [ ] Seeding is lazy and scoped per `resourceId` — a fresh `resourceId` gets ~28 seeded transactions across the trailing 30 days on first read
- [ ] Seed data spans most categories, with Dining and Shopping deliberately heavy so the first Monthly Review (ticket 04) has something to flag
- [ ] `seedCategory` carries the ground-truth label used later only by the Categorizer accuracy scorer (ticket 07) — not surfaced anywhere else
- [ ] Verified: querying `listTransactions` for two different `resourceId`s returns two independently-seeded transaction sets
