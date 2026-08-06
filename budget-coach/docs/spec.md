# Budget Coach — Tech Stack & Features

Planning artifact from the grilling session, captured before implementation planning begins. Standalone learning project, unrelated to `ag-ui-app`, `my-nextjs-agent`, or `ui-dojo`.

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) | New standalone project, sibling folder: `budget-coach/` |
| Package manager | pnpm | |
| Scaffold | CopilotKit official CLI | Canonical wiring instead of hand-copying `ag-ui-app` |
| Agent framework | Mastra | Agents, workflow, memory, storage, guardrails, scorers |
| Agent-UI bridge | AG-UI (`@ag-ui/mastra`) | |
| Frontend chat/UI kit | CopilotKit (`@copilotkit/react-core`, `@copilotkit/react-ui`) | Generative UI, shared state, frontend actions |
| Storage | LibSQL | Persists across sessions (Mastra's reference storage adapter) |
| LLM — dev | Ollama, `llama3.1` (local) | Mirrors `my-nextjs-agent/src/mastra/model.ts` pattern |
| LLM — prod | Google Gemini | Swap via env var when deploying; deploy target/platform out of scope for now |
| Currency/locale | Hardcoded USD | No i18n/multi-currency |

## Domain

Personal Budget Coach — chat-based budgeting assistant with a seeded transaction history.

- **Category taxonomy (fixed)**: Groceries, Dining, Transport, Utilities, Entertainment, Shopping, Housing, Health, Income, Other
- **Seed data**: ~25–30 transactions across the trailing 30 days, spread across most categories; a couple deliberately over a sensible spending limit so there's something to flag on first use
- **Transaction entry**: via chat (e.g. "I spent $40 at Trader Joe's"), plus a frontend add-transaction form/action
- **Initial budget limits**: not pre-seeded — proposed by the first Monthly Review from seed-transaction history (~110% of trailing spend), subject to HITL approval like any later adjustment

## Agent Architecture

- **`Categorizer`** agent — classifies transactions into the fixed taxonomy
- **`Analyst`** agent — computes spending patterns, flags overspend, produces chart data
- **`Coach`** agent — user-facing conversational front door; orchestrates `Categorizer` and `Analyst`, triggers the workflow
- **`Monthly Review` workflow** — `Categorizer → Analyst → propose adjustments`
  - Auto-runs once per calendar month on first load if not already run this month
  - Also chat-triggerable on demand ("run my monthly review")

## Features

- **Chat about your spending** — tell the assistant what you bought ("I spent $40 at Trader Joe's") and it logs the transaction, or ask it questions about your budget in plain English.
- **Automatic categorization** — every transaction gets sorted into a category (Groceries, Dining, Transport, etc.) automatically, but it always asks you to confirm before saving, so a miscategorized purchase never slips through silently.
- **Visual spending breakdown** — charts and progress bars show where your money is going and which categories are getting close to (or over) budget, right inside the chat.
- **Monthly check-ins** — once a month, the assistant reviews your spending on its own, and suggests updated budget limits based on how you've actually been spending. You approve or reject the suggestion — nothing changes without your say-so. You can also ask for a check-in anytime instead of waiting.
- **Remembers your goals** — tell it about a savings goal (e.g. "saving $2,000 for a trip by December") and it keeps that in mind across conversations, even after you close the tab and come back later.
- **Quick add-transaction shortcut** — when you mention a purchase in chat, it can pop open a pre-filled form so you can add it with one click instead of typing everything out.
- **Stays on topic and safe** — it's built to stick to budgeting help and won't offer real investment/financial advice, and it's hardened against attempts to manipulate it into ignoring its instructions.
- **Picks up where you left off** — your transaction history, budgets, and chat history are saved, so nothing resets when you refresh or come back the next day. Each browser gets its own separate budget.

## Explicitly Out of Scope (for now)

- Multi-currency / i18n
- User authentication / multi-user accounts beyond per-browser resourceId isolation
- Deployment platform selection (Vercel, etc.) — only the env-var-driven model provider swap is being prepared
