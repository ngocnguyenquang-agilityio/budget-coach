# Budget Coach — Features

One card per feature: purpose and key points. Source of truth for feature scope is [spec.md](spec.md).

## Onboarding

- **Purpose:**
  - Establish the initial app state
  - Introduce users to the app
- **Key points:**
  - User can see app's slogan and short description
  - The "Get Started" button navigates to the dashboard/chat

## Chat About Your Spending

- **Purpose:**
  - Let users log and query spending using natural language instead of forms
  - Make the Coach agent the primary interface to the budget
- **Key points:**
  - User can type things like "I spent $40 at Trader Joe's" and have it logged
  - User can ask plain-English questions about their budget (e.g. "how much did I spend on dining this month?")
  - Coach agent orchestrates Categorizer and Analyst behind the scenes to answer

## Automatic Categorization

- **Purpose:**
  - Reduce manual data entry for every transaction
  - Keep category assignment accurate via human oversight
- **Key points:**
  - Every transaction is auto-classified into one of the fixed categories (Groceries, Dining, Transport, etc.)
  - User is always asked to confirm the suggested category before it's saved
  - Confirmation happens via a `useHumanInTheLoop` card in the chat

## Visual Spending Breakdown

- **Purpose:**
  - Give an at-a-glance view of where money is going
  - Surface budget risk before it becomes a problem
- **Key points:**
  - Donut chart shows per-category spending breakdown
  - Progress bars show limit vs. actual per category, flagging over-budget categories
  - Both render inline in the chat as generative UI

## Monthly Check-ins

- **Purpose:**
  - Keep budget limits realistic without requiring the user to manage them manually
  - Give the user final say over any limit change
- **Key points:**
  - Runs automatically once per calendar month on first load, if not already run
  - Can also be triggered anytime by asking in chat ("run my monthly review")
  - Assistant proposes updated limits based on actual spending; user approves or rejects — nothing changes without confirmation

## Remembers Your Goals

- **Purpose:**
  - Let the assistant track long-term intent, not just individual transactions
  - Make goals persistent across sessions
- **Key points:**
  - User can state a savings goal (e.g. "saving $2,000 for a trip by December")
  - Goal is stored in working memory and survives closing the tab / returning later
  - Goal persists across chat threads, not just within one conversation

## Quick Add-Transaction Shortcut

- **Purpose:**
  - Speed up transaction entry when the user has already described a purchase in chat
  - Reduce retyping of details already mentioned
- **Key points:**
  - Mentioning a purchase in chat can pop open a pre-filled add-transaction form
  - Form fields (merchant, amount, category) are seeded from what was said in chat
  - User adds the transaction with one click instead of typing it all out

## Stays on Topic and Safe

- **Purpose:**
  - Keep the assistant scoped to budgeting help only
  - Prevent misuse via prompt injection or requests for regulated advice
- **Key points:**
  - Won't offer real investment or financial advice (e.g. "should I buy stock X")
  - Hardened against attempts to override its instructions ("ignore previous instructions")
  - Enforced via two guardrails: prompt-injection and financial-advice

## Picks Up Where You Left Off

- **Purpose:**
  - Make the app feel persistent and personal, not session-based
  - Keep each user's data isolated from others
- **Key points:**
  - Transaction history, budgets, and chat history are all saved and survive refresh/return
  - Each browser gets its own separate, independently-seeded budget
  - Backed by a per-browser `resourceId` cookie and file-backed LibSQL storage
