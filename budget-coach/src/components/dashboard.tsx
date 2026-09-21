"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
  useCopilotChatConfiguration,
  useDefaultRenderTool,
  useFrontendTool,
  useHumanInTheLoop,
  useInterrupt,
  useRenderTool,
} from "@copilotkit/react-core/v2";

import {
  CategorySchema,
  type Category,
  type CategoryLimits,
} from "@/domain/categories";
import { computeAnalysis, type AnalysisResult } from "@/domain/analysis";
import type { BudgetState } from "@/domain/budget-state";
import type { Transaction } from "@/db/transactions";
import { parseToolResult } from "@/lib/parse-tool-result";
import { CategoryBreakdownChart } from "@/components/category-breakdown-chart";
import { BudgetProgressBars } from "@/components/budget-progress-bars";
import { TransactionListCard } from "@/components/transaction-list-card";
import {
  ConfirmTransactionsCard,
  type ConfirmedTransaction,
  type RecordTransactionsResult,
} from "@/components/confirm-transactions-card";
import { SavingsGoalCard } from "@/components/savings-goal-card";
import { ChooseCategoryCard } from "@/components/choose-category-card";
import { MonthlyReviewCard } from "@/components/monthly-review-card";
import { RefitCard } from "@/components/refit-card";
import { SavingsPotsCard } from "@/components/savings-pots-card";
import { SavingsPotResultCard } from "@/components/savings-pot-result-card";
import { RefreshOnComplete } from "@/components/refresh-on-complete";
import type { PeriodAmendment, PeriodClose, PotAllocation } from "@/domain/period-close";
import { savingsBalance } from "@/domain/budget-state";
import { computeCap, savingsGoal as deriveSavingsGoal } from "@/domain/commitment";
import {
  AddTransactionForm,
  type AddTransactionFormPrefill,
} from "@/components/add-transaction-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const emptyAnalysis: AnalysisResult = {
  categoryTotals: [],
  expenseTotal: 0,
  committedExpenseTotal: 0,
  receivedIncome: 0,
  forecastIncome: 0,
  netSavings: 0,
};

export const Dashboard = () => {
  const { agent, isReady } = useAgent({
    agentId: "coach",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const state = (agent.state as BudgetState | undefined) ?? {};
  // Read-only access to the active thread id (uncontrolled provider convention
  // is preserved — we never pass a threadId prop, only read the current one).
  const configuration = useCopilotChatConfiguration();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<
    Category | undefined
  >(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [formPrefill, setFormPrefill] = useState<AddTransactionFormPrefill>({});

  const handleSelectCategory = useCallback((category: Category) => {
    setSelectedCategory((current) => (current === category ? undefined : category));
  }, []);

  const hydratedAgentRef = useRef<typeof agent | null>(null);
  useEffect(() => {
    if (!isReady || hydratedAgentRef.current === agent) return;
    hydratedAgentRef.current = agent;
    let cancelled = false;
    fetch("/api/working-memory")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        agent.setState({ categoryLimits: {}, ...data.state });
      })
      .catch(() => {
        if (!cancelled) agent.setState({ categoryLimits: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [agent, isReady]);

  const refreshTransactions = useCallback(async () => {
    const res = await fetch("/api/transactions");
    const data = await res.json();
    setTransactions(data.transactions ?? []);
  }, []);

  // Deterministic write path for the confirm-transactions card: persist the
  // exact rows the user confirmed (categories included) server-side, bypassing
  // the model so it can't substitute its own earlier categorizeBatch guess.
  // threadId lets the reused addTransactionsTool run its income-drift check.
  const recordTransactions = useCallback(
    async (transactions: ConfirmedTransaction[]): Promise<RecordTransactionsResult> => {
      const res = await fetch("/api/transactions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions, threadId: configuration?.threadId }),
      });
      if (!res.ok) throw new Error(`Failed to record transactions (${res.status})`);
      const result = (await res.json()) as RecordTransactionsResult;
      await refreshTransactions();
      return result;
    },
    [configuration?.threadId, refreshTransactions],
  );

  useEffect(() => {
    refreshTransactions();
  }, [refreshTransactions]);

  // Static — the dashboard shows the current month only, no navigation.
  const visibleMonth = new Date().toISOString().slice(0, 7);

  const analysis = useMemo(
    () => computeAnalysis(transactions, state.categoryLimits ?? {}, visibleMonth),
    [transactions, state.categoryLimits, visibleMonth],
  );

  // This month's expected (unconfirmed) rows, folded into frontend context so
  // the Coach can recognize "my rent went out" as confirming a scheduled
  // payment without a listExpectedTransactions round-trip. Mirrors that tool's
  // shape (transfers can't be expected — see confirm-transaction.ts).
  const expectedTransactions = useMemo(
    () =>
      transactions
        .filter(
          (t) =>
            t.status === "expected" &&
            t.type !== "transfer" &&
            t.date.startsWith(visibleMonth),
        )
        .map(({ merchant, amount, type, date }) => ({ merchant, amount, type, date })),
    [transactions, visibleMonth],
  );

  // Gate 1 — pure frontend tool, no server suspend. The Coach calls this
  // (per its instructions) after categorizing the described purchase(s) as a
  // batch; on confirm the card writes them itself via recordTransactions, then
  // tells the model they're already saved (deterministic — the model never
  // re-emits the categories).
  useHumanInTheLoop(
    {
      name: "confirmTransactions",
      description:
        "Ask the user to confirm one or more transactions — the suggested type (income/expense) and category for each — before recording them.",
      parameters: z.object({
        // Every field is optional because args stream in incrementally (see
        // the useRenderTool gotcha in CLAUDE.md) — the whole items array, and
        // each field within an item, may still be undefined on first render.
        items: z
          .array(
            z.object({
              merchant: z.string().optional(),
              amount: z.number().optional(),
              type: z.enum(["income", "expense"]).optional(),
              suggested: CategorySchema.optional(),
              date: z.string().optional(),
            }),
          )
          .optional(),
      }),
      render: ({ args, status, respond, result }) => (
        <ConfirmTransactionsCard
          items={args.items}
          status={status}
          respond={respond}
          result={result}
          recordTransactions={recordTransactions}
        />
      ),
    },
    [recordTransactions],
  );

  // Gate 1a — pure frontend tool, no server suspend. Collects a monthly
  // savings amount whenever the Coach needs one, instead of asking in plain
  // chat text. setSavingsGoal turns it into the General Savings pot
  // (ADR-0013); the user never has to hear the word "pot".
  useHumanInTheLoop(
    {
      name: "provideSavingsGoal",
      description: "Ask the user for their monthly savings goal.",
      parameters: z.object({}),
      render: ({ status, respond, result }) => (
        <SavingsGoalCard status={status} respond={respond} result={result} />
      ),
    },
    [],
  );

  // Gate 1b — pure frontend tool, no server suspend. When the user names two
  // or more categories to filter to (selectCategory takes only one), the Coach
  // calls this instead of asking in plain text; on pick the card applies the
  // filter itself via setSelectedCategory, then tells the model.
  useHumanInTheLoop(
    {
      name: "chooseCategory",
      description:
        "Ask the user to pick a single category to filter the Transactions list to, when they named two or more at once.",
      parameters: z.object({
        // Optional because args stream in incrementally (CLAUDE.md gotcha).
        categories: z.array(CategorySchema.optional()).optional(),
      }),
      render: ({ args, status, respond, result }) => (
        <ChooseCategoryCard
          categories={args.categories}
          status={status}
          respond={respond}
          result={result}
          onSelect={setSelectedCategory}
        />
      ),
    },
    [],
  );

  // Gate 2 — server-side Mastra suspend/resume via approveBudgetTool.
  // @ag-ui/mastra emits both an interrupt shapes for every tool suspend: a
  // legacy `on_interrupt` custom event (event.value.suspendPayload directly)
  // and, since MastraAgent's emitInterruptOutcome defaults to true, a
  // standard AG-UI interrupt (event.value.metadata.mastra.suspendPayload).
  // useInterrupt (@copilotkit/react-core v2) prefers the standard shape
  // whenever both are present, so the legacy top-level field is never what
  // actually arrives here — read both, standard first, and event.value may
  // arrive as a JSON string rather than an object.
  useInterrupt({
    agentId: "coach",
    renderInChat: true,
    render: ({ event, resolve }) => {
      const raw = event.value ?? {};
      // Both approveBudget and refitBudget suspend on the "coach" agent, so a
      // single useInterrupt handles both — `kind` on the payload picks the card
      // (defaults to monthly-review for runs suspended before it existed).
      type Payload = {
        proposedLimits?: CategoryLimits;
        currentLimits?: CategoryLimits;
        analysis?: AnalysisResult;
        cap?: number;
        commitments?: number;
        periodCloses?: PeriodClose[];
        amendments?: PeriodAmendment[];
        kind?: "monthly-review" | "refit";
      };
      type SuspendPayload = {
        suspendPayload?: Payload;
        metadata?: { mastra?: { suspendPayload?: Payload } };
      };
      let parsed: SuspendPayload = {};
      try {
        parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as SuspendPayload;
      } catch {
        // Malformed suspend payload — fall through to the empty-state card
        // below rather than crashing the render.
      }
      const payload: Payload = parsed.metadata?.mastra?.suspendPayload ?? parsed.suspendPayload ?? {};

      if (payload.kind === "refit") {
        return (
          <RefitCard
            proposedLimits={payload.proposedLimits ?? {}}
            currentLimits={payload.currentLimits ?? {}}
            analysis={payload.analysis ?? emptyAnalysis}
            cap={payload.cap ?? 0}
            commitments={payload.commitments ?? 0}
            onApprove={(edits) => resolve({ decision: "approve", edits })}
            onReject={() => resolve({ decision: "reject" })}
          />
        );
      }

      return (
        <MonthlyReviewCard
          proposedLimits={payload.proposedLimits ?? {}}
          analysis={payload.analysis ?? emptyAnalysis}
          cap={payload.cap}
          commitments={payload.commitments}
          periodCloses={payload.periodCloses ?? []}
          amendments={payload.amendments ?? []}
          onApprove={(edits: CategoryLimits, allocationEdits?: PotAllocation[]) =>
            resolve({ decision: "approve", edits, allocationEdits })
          }
          onReject={() => resolve({ decision: "reject" })}
        />
      );
    },
  });

  // Generative UI — every field optional since render params stream in
  // incrementally, and tool `result` is parsed defensively as a JSON string.
  useRenderTool(
    {
      name: "analyzeSpending",
      parameters: z.object({}),
      render: ({ status, result }) => {
        if (status !== "complete") {
          return (
            <p className="text-sm text-[var(--muted-foreground)]">
              Analyzing spending…
            </p>
          );
        }
        const parsed = parseToolResult<AnalysisResult | { success: false }>(
          result,
          emptyAnalysis,
        );
        if ("success" in parsed) {
          return (
            <p className="text-sm text-[var(--destructive)]">
              Analysis failed — ask me to analyze your spending again.
            </p>
          );
        }
        const parsedAnalysis = parsed;
        return (
          <div className="space-y-4 mx-auto my-2 w-full max-w-md">
            <CategoryBreakdownChart analysis={parsedAnalysis} />
            <BudgetProgressBars
              analysis={parsedAnalysis}
              categoryLimits={state.categoryLimits ?? {}}
            />
          </div>
        );
      },
    },
    [state.categoryLimits],
  );

  useRenderTool(
    {
      name: "listTransactions",
      parameters: z.object({}),
      render: ({ status, result }) => {
        if (status !== "complete") {
          return (
            <p className="text-sm text-[var(--muted-foreground)]">
              Fetching transactions…
            </p>
          );
        }
        const parsedTransactions = parseToolResult<{
          transactions: Transaction[];
        }>(result, {
          transactions: [],
        }).transactions;
        return (
          <div className="mx-auto my-2 w-full max-w-md">
            <TransactionListCard transactions={parsedTransactions} />
          </div>
        );
      },
    },
    [],
  );

  // Confirming an expected transaction, adding a recurring schedule, or
  // recording a pot-funded expense all change what the Transactions list
  // shows — refresh it on completion so the dashboard reflects them without a
  // manual reload.
  useRenderTool(
    {
      name: "confirmExpectedTransaction",
      parameters: z.object({}),
      render: ({ status }) => (
        <RefreshOnComplete status={status} onComplete={refreshTransactions} />
      ),
    },
    [refreshTransactions],
  );

  useRenderTool(
    {
      name: "addRecurringSchedule",
      parameters: z.object({}),
      render: ({ status }) => (
        <RefreshOnComplete status={status} onComplete={refreshTransactions} />
      ),
    },
    [refreshTransactions],
  );

  // Savings pot actions — each renders a progress card in chat from the tool
  // `result` (parsed defensively as a JSON string). Params schema is empty
  // since we render from the result, not the streamed args. deleteSavingsPot
  // has no card — the Coach relays its message and the dashboard section
  // updates from state.savingsPots.
  useRenderTool(
    {
      name: "createSavingsPot",
      parameters: z.object({}),
      render: ({ status, result }) => (
        <SavingsPotResultCard status={status} result={result} />
      ),
    },
    [],
  );

  // allocateToPot and deleteSavingsPot now also write a transfer transaction
  // (unallocated <-> pot), so the Transactions list needs refreshing the same
  // way confirmExpectedTransaction/addRecurringSchedule do above.
  useRenderTool(
    {
      name: "allocateToPot",
      parameters: z.object({}),
      render: ({ status, result }) => (
        <>
          <SavingsPotResultCard status={status} result={result} />
          <RefreshOnComplete status={status} onComplete={refreshTransactions} />
        </>
      ),
    },
    [refreshTransactions],
  );

  useRenderTool(
    {
      name: "updateSavingsPot",
      parameters: z.object({}),
      render: ({ status, result }) => (
        <SavingsPotResultCard status={status} result={result} />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "deleteSavingsPot",
      parameters: z.object({}),
      render: ({ status }) => (
        <RefreshOnComplete status={status} onComplete={refreshTransactions} />
      ),
    },
    [refreshTransactions],
  );

  useDefaultRenderTool();

  // Frontend actions.
  useFrontendTool(
    {
      name: "openAddTransactionForm",
      description:
        "Open the add-transaction form, optionally pre-filled from what the user described.",
      parameters: z.object({
        merchant: z.string().optional(),
        amount: z.number().optional(),
        type: z.enum(["income", "expense"]).optional(),
        category: CategorySchema.optional(),
      }),
      handler: async ({ merchant, amount, type, category }) => {
        // When the Coach opens the form for a described purchase without an
        // explicit category, classify the merchant through the same categorizer
        // the confirmTransactions flow uses (/api/categorize → categorizeItems)
        // rather than trusting the Coach's own guess. An explicit category from
        // the Coach (the user named one) is honored as-is.
        let resolvedType = type;
        let resolvedCategory = category;
        if (merchant && category === undefined) {
          try {
            const res = await fetch("/api/categorize", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ merchant, amount: amount ?? 0 }),
            });
            if (res.ok) {
              const data = (await res.json()) as {
                type?: "income" | "expense";
                category?: Category | null;
              };
              resolvedType = type ?? data.type;
              resolvedCategory = data.category ?? undefined;
            }
          } catch {
            // Fall back to opening the form uncategorized (it defaults to "Other").
          }
        }
        setFormPrefill({ merchant, amount, type: resolvedType, category: resolvedCategory });
        setFormOpen(true);
        return "Opened the add-transaction form.";
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "selectCategory",
      description:
        "Filter the Transactions list on the dashboard down to one category, exactly as if the user clicked that category's row. Omit category to clear the filter and show all transactions again. Only call this when the user explicitly asks to filter, highlight, show, or point out a category (e.g. \"show me Dining\") — never automatically just because a category came up while answering a question. Supports exactly one category: if the user names two or more categories at once, do not call this and do not pick one yourself — ask them which single one they want.",
      parameters: z.object({ category: CategorySchema.optional() }),
      handler: async ({ category }) => {
        setSelectedCategory(category);
        return category
          ? `Filtered transactions to ${category}.`
          : "Cleared the transaction filter.";
      },
    },
    [],
  );

  useAgentContext({
    description:
      "The month currently visible on the dashboard, any category the Transactions list is currently filtered to, this month's expected (unconfirmed) transactions, and the user's stored Coach Preferences (round-tripped from working memory so the Coach's instructions can weave them in as directives — see coach.ts)",
    value: {
      visibleMonth,
      selectedCategory: selectedCategory ?? null,
      expectedTransactions,
      coachPreferences: state.coachPreferences ?? null,
    },
  });

  // Onboarding chips for an empty chat — fixed and free, no model call.
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Log a purchase", message: "I made a purchase — help me log it." },
      { title: "Log income", message: "I got paid — help me log it." },
      {
        title: "Add my salary",
        message: "Help me set up my salary as a recurring payment.",
      },
      {
        title: "Save for something",
        message: "I want to start saving for something — help me set it up.",
      },
      { title: "Review my budget", message: "Run my monthly budget review." },
      {
        title: "Category breakdown",
        message: "How am I doing across categories this month?",
      },
    ],
  });

  // Once the conversation has started, replace the fixed chips with ones
  // grounded in what just happened. Generated via providerAgentId: "suggester"
  // — a memoryless agent — NOT the Coach: the suggestion engine runs the
  // provider on a throwaway thread id, and any provider that carries Memory
  // (the Coach does) persists that thread to LibSQL, flooding the conversation
  // sidebar with phantom threads on every suggestion refresh. The suggester is
  // seeded with the Coach's messages and state, so it needs no memory of its own.
  useConfigureSuggestions({
    instructions:
      "Suggest 2-3 short next actions for this budget coach conversation, phrased as first-person messages the user could send next (e.g. 'Set a monthly savings goal of $500.', 'How am I doing on Dining this month?'). Build on what just happened — e.g. after logging a transaction, suggest checking category totals or setting a goal. Never suggest something the user just did (e.g. don't suggest logging income right after they logged income).",
    minSuggestions: 2,
    maxSuggestions: 3,
    available: "after-first-message",
    providerAgentId: "suggester",
  });

  const overLimitCount = analysis.categoryTotals.filter(
    (entry) => entry.overLimit,
  ).length;

  // Savings Goal is derived from pot rates, never stored (ADR-0013), and the
  // Savings Balance is pot balances plus whatever is unallocated (ADR-0012).
  const pots = state.savingsPots ?? [];
  const monthlyGoal = deriveSavingsGoal(pots, visibleMonth);
  const balance = savingsBalance(state);
  const unallocated = state.unallocated ?? 0;

  // A target pot re-derives its rate every Period, so the Cap moves on its own
  // as deadlines approach — limits can drift above it with no user action and
  // nothing to trigger a refit (ADR-0014). Surface it here so the drift is
  // visible rather than silent; the user asks the Coach to re-fit.
  const cap = computeCap({ forecastIncome: analysis.forecastIncome, pots, period: visibleMonth });
  const committedLimits = Object.values(state.categoryLimits ?? {}).reduce(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const limitsExceedCap = analysis.forecastIncome > 0 && cap > 0 && committedLimits > cap;

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-[var(--background)] p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Budget Coach</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              {new Date(`${visibleMonth}-01`).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <Button
            onClick={() => {
              setFormPrefill({});
              setFormOpen(true);
            }}
          >
            + Add transaction
          </Button>
        </div>

        <AddTransactionForm
          open={formOpen}
          prefill={formPrefill}
          onClose={() => setFormOpen(false)}
          onSaved={refreshTransactions}
        />

        {limitsExceedCap && (
          <div className="rounded-[var(--radius)] border border-[var(--destructive)] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] p-3 text-sm">
            Your category limits add up to ${committedLimits.toFixed(2)}, but your savings pots leave only
            ${cap.toFixed(2)} to spend. Ask the coach to re-fit your budget.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Income received this month
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--budget-chart-positive)" }}>
                ${analysis.receivedIncome.toFixed(2)}
              </p>
              {analysis.forecastIncome > analysis.receivedIncome && (
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)] tabular-nums">
                  ${analysis.forecastIncome.toFixed(2)} expected
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Expenses this month
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                ${analysis.expenseTotal.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Net savings
                {monthlyGoal > 0 ? ` / $${monthlyGoal.toFixed(2)} goal` : ""}
              </p>
              <p
                className={`mt-1 text-xl font-semibold tabular-nums ${
                  monthlyGoal > 0 && analysis.netSavings < monthlyGoal
                    ? "text-[var(--destructive)]"
                    : ""
                }`}
              >
                ${analysis.netSavings.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Savings balance
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                ${balance.toFixed(2)}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)] tabular-nums">
                ${unallocated.toFixed(2)} unallocated
              </p>
            </CardContent>
          </Card>
          <Card className="col-span-2 md:col-span-2">
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Over budget
              </p>
              <p
                className={`mt-1 text-xl font-semibold tabular-nums ${overLimitCount > 0 ? "text-[var(--destructive)]" : ""}`}
              >
                {overLimitCount}{" "}
                {overLimitCount === 1 ? "category" : "categories"}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spending by category</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryBreakdownChart analysis={analysis} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Category limits</CardTitle>
            </CardHeader>
            <CardContent>
              <BudgetProgressBars
                analysis={analysis}
                categoryLimits={state.categoryLimits ?? {}}
                selectedCategory={selectedCategory}
                onSelectCategory={handleSelectCategory}
              />
            </CardContent>
          </Card>
        </div>

        <SavingsPotsCard pots={pots} />

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base">
              {selectedCategory ? `Transactions — ${selectedCategory}` : "Transactions"}
            </CardTitle>
            {selectedCategory && (
              <button
                type="button"
                onClick={() => setSelectedCategory(undefined)}
                className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                Reset
              </button>
            )}
          </CardHeader>
          <CardContent>
            <TransactionListCard
              transactions={transactions}
              selectedCategory={selectedCategory}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
