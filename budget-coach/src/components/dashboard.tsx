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
import { DeclaredIncomeCard } from "@/components/declared-income-card";
import { DeclaredIncomeResultCard } from "@/components/declared-income-result-card";
import { SavingsGoalCard } from "@/components/savings-goal-card";
import { MonthlyReviewCard } from "@/components/monthly-review-card";
import { FundingPlanCard } from "@/components/funding-plan-card";
import type { Target } from "@/domain/funding-plan";
import {
  AddTransactionForm,
  type AddTransactionFormPrefill,
} from "@/components/add-transaction-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const emptyAnalysis: AnalysisResult = { categoryTotals: [], expenseTotal: 0, incomeTotal: 0, netSavings: 0 };

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

  // Gate 1a — pure frontend tool, no server suspend. Same shape as
  // provideDeclaredIncome below, for whenever the Coach needs the user's
  // savings goal (unset, or they want to change it) — replaces asking in
  // plain chat text so both prerequisites for a Monthly Review collect the
  // same way.
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

  // Gate 1b — pure frontend tool, no server suspend (ADR-0007). The Coach
  // calls this before starting a Monthly Review, so Declared Income is
  // collected before the workflow ever runs; Cancel means it never starts,
  // so there's nothing to discard.
  useHumanInTheLoop(
    {
      name: "provideDeclaredIncome",
      description: "Ask the user for their income figure before running a Monthly Review.",
      parameters: z.object({}),
      render: ({ status, respond, result }) => (
        <DeclaredIncomeCard status={status} respond={respond} result={result} />
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
      // Both approveBudget and planFunding suspend on the "coach" agent, so a
      // single useInterrupt handles both — `kind` on the payload picks the card
      // (defaults to monthly-review for runs suspended before it existed).
      type Payload = {
        proposedLimits?: CategoryLimits;
        analysis?: AnalysisResult;
        cap?: number;
        kind?: "monthly-review" | "funding-plan";
        target?: Target;
        requiredPerMonth?: number;
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

      if (payload.kind === "funding-plan" && payload.target) {
        return (
          <FundingPlanCard
            proposedLimits={payload.proposedLimits ?? {}}
            analysis={payload.analysis ?? emptyAnalysis}
            cap={payload.cap}
            target={payload.target}
            requiredPerMonth={payload.requiredPerMonth ?? 0}
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
          onApprove={(edits) => resolve({ decision: "approve", edits })}
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

  // setDeclaredIncome now records an Income transaction (declared income is
  // mirrored into "Income this month"); refresh the transaction list on
  // complete so the dashboard reflects it without a manual reload.
  useRenderTool(
    {
      name: "setDeclaredIncome",
      parameters: z.object({ declaredIncome: z.number().optional() }),
      render: ({ status, result }) => (
        <DeclaredIncomeResultCard
          status={status}
          result={result}
          onComplete={refreshTransactions}
        />
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
        setFormPrefill({ merchant, amount, type, category });
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
      "The month currently visible on the dashboard, any category the Transactions list is currently filtered to, and the user's stored Coach Preferences (round-tripped from working memory so the Coach's instructions can weave them in as directives — see coach.ts)",
    value: {
      visibleMonth,
      selectedCategory: selectedCategory ?? null,
      coachPreferences: state.coachPreferences ?? null,
    },
  });

  // Onboarding chips for an empty chat — fixed and free, no model call.
  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Log a purchase", message: "I spent $40 at Trader Joe's." },
      { title: "Log income", message: "I got paid $3000." },
      {
        title: "Set a savings goal",
        message: "Set a monthly savings goal of $500.",
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

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Income this month
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums" style={{ color: "var(--chart-positive)" }}>
                ${analysis.incomeTotal.toFixed(2)}
              </p>
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
                {state.savingsGoal !== undefined ? ` / $${state.savingsGoal.toFixed(2)} goal` : ""}
              </p>
              <p
                className={`mt-1 text-xl font-semibold tabular-nums ${
                  state.savingsGoal !== undefined && analysis.netSavings < state.savingsGoal
                    ? "text-[var(--destructive)]"
                    : ""
                }`}
              >
                ${analysis.netSavings.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card className="col-span-2 md:col-span-3">
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
