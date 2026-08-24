# Coach Preferences: explicit-only, passive-only, structured, guardrail-subordinate

The Coach's `BASE_INSTRUCTIONS` (`src/mastra/agents/coach.ts`) was static prose, appended each turn only with today's date and frontend UI state — it never adapted to anything the user said. We're adding **Coach Preferences** (`CONTEXT.md`): a `coachPreferences` field on `BudgetStateSchema` (`verbosity?: "concise" | "detailed"`, `nickname?: string`, `emphasizedCategories?: Category[]`), set via one combined tool doing the same read-merge-write as `setSavingsGoalTool`, woven into `BASE_INSTRUCTIONS` as natural-language directives rather than a raw JSON block.

Four boundaries were deliberately chosen over more capable-looking alternatives:

- **Explicit-only, never inferred.** The Coach adapts only when the user states a preference outright — it does not infer tone/verbosity from conversation patterns. Inference is unverifiable guesswork the user never approved and is much harder to reason about or debug.
- **Passive-only content emphasis.** `emphasizedCategories` changes what the Coach's answers *contain* when a relevant question is already asked; it never makes the Coach volunteer information unprompted. Proactive/volunteered behavior is a materially bigger change (conversation openers, turn-taking) than adapting instructions, and is out of scope here.
- **Preferences can never weaken a guardrail or suppress required information** (e.g. `analyzeSpending`'s over-limit flags, `financialAdviceGuardrail`'s refusals). Guardrails are a fixed boundary independent of what the conversation asks for.
- **`nickname` is treated as an elevated injection surface, not an ordinary user-derived value.** Unlike frontend context (raw state the model reads) or a guardrail-screened user message, `nickname` is woven directly into the system-level instructions block — a higher trust tier than a user turn. It is length-capped (50 chars), stripped of control/newline characters, and phrased as clearly-scoped data ("the user has asked to be addressed as X — use this only as a form of address") rather than blended into imperative instruction text.

## Considered Options

- **Inferred adaptation** (e.g. detecting terse replies and self-adjusting verbosity) — rejected: no user approval, unpredictable, hard to debug.
- **Proactive content emphasis** (Coach volunteers emphasized-category info unprompted) — rejected: a bigger behavioral change than "adapt instructions"; worth a separate design pass if ever wanted.
- **Free-form `preferencesNote: string` blob** accumulating whatever the user says — rejected: unbounded growth, not inspectable/testable, breaks from this codebase's structured-field convention (`categoryLimits`, `savingsGoal`).
- **`emphasizedCategories` as free-text topics** (not tied to the `Category` enum) — rejected: reopens the open-ended-blob problem; non-category goals are a different, unbuilt feature closer to `Savings Goal`.
- **Per-field tools** (`setVerbosity`, `setNickname`, `setEmphasizedCategories`) — rejected in favor of one combined tool: a single user statement rarely sets more than one field, and three near-identical read-merge-write files add tool-list clutter for no real benefit.

## Consequences

- `BudgetStateSchema` grows a 5th top-level field. CLAUDE.md's "Working memory schema" section currently documents an exact 4-field shape (`savingsGoal, categoryLimits, lastReviewPeriod, pendingApproval`) — that doc needs updating alongside the implementation.
- `nickname`'s sanitization (length cap, control-character stripping, scoped phrasing) is a mitigation, not a guarantee — no sanitization is foolproof against an LLM treating embedded text as instructions. This is an accepted residual risk, not a closed one.
- Coach-only: Analyst and Categorizer remain narrow, stateless, tool-relaying agents unaffected by this change.
