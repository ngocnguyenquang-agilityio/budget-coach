# Clerk for authentication, with Clerk's userId used directly as resourceId

Budget Coach needs real per-User accounts for cross-device continuity (see `CONTEXT.md`'s `User` term), replacing the anonymous per-browser `resourceId` cookie (`src/middleware.ts`). We chose Clerk over Better-Auth: Clerk ships working sign-in/sign-up UI, session verification, email verification, and password-reset flows out of the box, whereas Better-Auth would require building that surface ourselves — including a schema migration into our own LibSQL DB and registering real Google OAuth credentials from day one — in a library neither of us has used before. That extra, unfamiliar, security-sensitive surface area was judged a bigger implementation risk than taking on Clerk as a hosted dependency. Clerk's `userId` is used directly as the Mastra `resourceId` everywhere data is already scoped by it (transactions, working memory, threads) — no separate `users` table or mapping layer in LibSQL.

## Considered Options

- **Better-Auth** — fully self-hosted, consistent with the rest of the stack (Mastra, LibSQL, Cerebras), but rejected: more code to write in an unfamiliar library, plus its own DB schema and real OAuth app registration needed even for local dev.

## Consequences

- Login becomes mandatory for the whole app; the anonymous `resourceId` cookie scheme is retired, and any data currently scoped to anonymous cookies (local or on the live Vercel/Turso deployment) is discarded, not migrated.
- User identity lives outside the project's own LibSQL DB, in Clerk's hosted system — Clerk is now a required external dependency and, at scale, a potentially paid one.
