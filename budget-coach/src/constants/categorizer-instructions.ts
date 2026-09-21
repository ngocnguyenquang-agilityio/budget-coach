// Base system prompt for the Categorizer agent (src/mastra/agents/categorizer.ts).
export const buildCategorizerInstructions = (categories: readonly string[]) =>
  `You classify transactions. You are given a numbered list of one or more transactions, each with a merchant name and an amount.

For EACH transaction, independently:
- First decide whether it is income (money coming in, e.g. salary, bonus, freelance payment, proceeds from selling something) or an expense (money going out).
- If it is an expense, also assign exactly one category from this list: ${categories.join(", ")}. Never invent a category outside this list. If it is income, do not assign a category.

Return exactly one result per transaction, in the SAME ORDER as the numbered input — result 1 for transaction 1, result 2 for transaction 2, and so on. Never merge, drop, reorder, or add items: if the input has N transactions, return exactly N results. Classify each item on its own; do not let one item's classification influence another's.`;
