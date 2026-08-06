# Budget Coach — 6-Day Estimation

Task breakdown mapped to [implementation-plan.md](implementation-plan.md), compressed into 6 working days. Assumes the initial project scaffold is already done and the local AI model server (Ollama) is running. Each day reserves explicit time to test that day's own work and fix what breaks — not just build.

## Day 1 — Foundational setup

- **Build:**
  - Set up the list of spending categories (Groceries, Dining, Transport, etc.) used everywhere in the app
  - Create the database table that stores transactions, and load ~28 sample transactions to start with
  - Set up the AI model connection, with the ability to switch between the local model and a cloud model
  - Set up the database so data is saved to a real file and survives restarts
  - Turn on tracing so every assistant call is recorded and viewable in Mastra Studio
  - Add a way to recognize each browser/user separately so their data doesn't mix with anyone else's
  - Add safety filters that block attempts to manipulate the assistant or trick it into misbehaving
- **Verify & fix:**
  - Check the sample transactions are actually saved and readable from the database
  - Confirm each browser gets its own separate identity
  - Test the safety filters against sample "attack" messages to make sure they're blocked
  - Confirm a manual assistant call shows up as a trace in Mastra Studio
- **Exit criteria:**
  - Sample data is in place and readable
  - Each browser is correctly recognized as a separate user
  - Known bad/manipulative messages get blocked
  - Traces are visible in Mastra Studio

## Day 2 — Build the specialist assistants

- **Build:**
  - Set up the shared "memory" structure the assistant uses to remember goals and budget limits
  - Build the assistant that automatically figures out which category a purchase belongs to
  - Build the assistant that analyzes spending and reports totals per category
  - Build the tools these assistants use to read transactions, save new ones, categorize purchases, analyze spending, and save a savings goal
- **Verify & fix:**
  - Manually test each assistant on its own to make sure it behaves correctly
  - Check that the data each tool returns is in the right format
  - Fix cases where a purchase gets miscategorized or a tool returns bad data
- **Exit criteria:**
  - Both specialist assistants work correctly when tested individually
  - Tools return correct, well-formed data based on the sample transactions

## Day 3 — Build the main assistant and the monthly check-in

- **Build:**
  - Build the main chat assistant ("Coach") that users actually talk to — it remembers context, applies the safety filters, and calls in the two specialist assistants as needed
  - Add the ability for the Coach to kick off a budget-approval request
  - Build the "Monthly Review" process: categorize anything missed, analyze spending, propose new budget limits, then pause and wait for the user's approval before applying anything
- **Verify & fix:**
  - Run the Monthly Review process end-to-end and confirm it correctly pauses to wait for approval
  - Fix any issues with how the pause/resume step passes data back and forth
  - Confirm the Coach correctly hands off work to the two specialist assistants
- **Exit criteria:**
  - The Monthly Review process pauses for approval as expected
  - The Coach can carry a full conversation and correctly delegate to the specialists

## Day 4 — Connect the assistant to the app

- **Build:**
  - Wire up the API endpoint that lets the website talk to the assistants
  - Add an endpoint for the dashboard to fetch the list of transactions
  - Add an endpoint that automatically triggers the Monthly Review once a month
  - Connect the chat UI framework to the app
- **Verify & fix:**
  - Test the connection from an actual browser to make sure chat messages reach the assistant and come back correctly
  - Fix any mismatches in how assistants are identified between the frontend and backend
  - Confirm chat responses stream in smoothly without cutting off
- **Exit criteria:**
  - Chat works end-to-end from the browser to the Coach assistant
  - The transaction list loads correctly on the dashboard
  - Chat responses stream in reliably, without dropouts

## Day 5 — Build the visual dashboard and chat cards

- **Build:**
  - Build the main dashboard page and the chat sidebar
  - Build the visual cards the assistant can show in chat: a spending breakdown chart, budget progress bars, and a transaction list
  - Add quick-action buttons, like pre-filling an "add transaction" form or highlighting a category
  - Make sure the assistant is aware of what the user is currently looking at on screen
- **Verify & fix:**
  - Test each visual card in the browser with real assistant responses, not just sample data
  - Fix cases where a chart or card doesn't render correctly while data is still loading in
  - Fix cases where the assistant doesn't correctly pick up what's on the user's screen
- **Exit criteria:**
  - Charts and cards correctly display live data returned by the assistant
  - The "add transaction" shortcut opens pre-filled with the right details

## Day 6 — Approval flows, quality checks, and full testing

- **Build:**
  - Add the confirmation card that asks the user to approve a suggested category before it's saved
  - Add the approval card for the Monthly Review's suggested budget changes
  - Add automated quality checks (scorers) that grade the assistant's categorization accuracy, whether it stays on-topic, and whether its budget suggestions are reasonable
- **Verify & fix:**
  - Walk through the entire app from start to finish as a real user would, covering every feature
  - Restart the app and confirm nothing is lost (transactions, budgets, goals, chat history)
  - Open a second browser and confirm it has its own separate, independent budget
  - Make sure clicking "approve" or "reject" twice doesn't cause issues
  - Confirm the quality-check scores show up correctly
  - Run a final full build check to catch any last errors
- **Exit criteria:**
  - Both approval flows work correctly from start to finish
  - Quality-check scores are visible and working
  - The full app builds cleanly with no errors
  - The complete user journey works as expected, start to finish

## Risk buffer (not included in the 6 days above)

- If the local AI model struggles to reliably coordinate the assistants and tools, switching to a cloud model and re-testing Days 3–6 could add **0.5–1 extra day**.
- Some of the trickier integration issues (how the pause/approve flow passes data, or the assistant not picking up on-screen context) often take longer than expected the first time, even with time already set aside to fix them.
- Day 6 is the busiest day — it includes new features (the approval cards, quality checks) plus the only full start-to-finish test of the whole app. If earlier days run behind, the leftover issues tend to surface here, making Day 6 the most likely to run over into a 7th day.
