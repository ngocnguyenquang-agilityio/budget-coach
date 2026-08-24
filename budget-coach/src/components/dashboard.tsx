"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useConfigureSuggestions,
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
import { ConfirmTransactionCard } from "@/components/confirm-transaction-card";
import { MonthlyReviewCard } from "@/components/monthly-review-card";
import {
  AddTransactionForm,
  type AddTransactionFormPrefill,
} from "@/components/add-transaction-form";
import { AddTransactionResultCard } from "@/components/add-transaction-result-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const emptyAnalysis: AnalysisResult = { categoryTotals: [], expenseTotal: 0, incomeTotal: 0, netSavings: 0 };
const HIGHLIGHTED_CATEGORY_STORAGE_KEY = "budget-coach:highlightedCategory";

export const Dashboard = () => {
  const { agent, isReady } = useAgent({
    agentId: "coach",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const state = (agent.state as BudgetState | undefined) ?? {};

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [highlightedCategory, setHighlightedCategory] = useState<
    Category | undefined
  >(() => {
    if (typeof window === "undefined") return undefined;
    const stored = window.localStorage.getItem(HIGHLIGHTED_CATEGORY_STORAGE_KEY);
    return CategorySchema.safeParse(stored).success
      ? (stored as Category)
      : undefined;
  });
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
  // (per its instructions) after categorizing a described purchase; on
  // confirm it's told to call addTransaction itself.
  useHumanInTheLoop(
    {
      name: "confirmTransaction",
      description:
        "Ask the user to confirm the suggested type (income/expense) and category for a transaction before recording it.",
      parameters: z.object({
        merchant: z.string().optional(),
        amount: z.number().optional(),
        type: z.enum(["income", "expense"]).optional(),
        suggested: CategorySchema.optional(),
        date: z.string().optional(),
      }),
      render: ({ args, status, respond, result }) => (
        <ConfirmTransactionCard
          merchant={args.merchant}
          amount={args.amount}
          type={args.type}
          suggested={args.suggested}
          date={args.date}
          status={status}
          respond={respond}
          result={result}
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
      type SuspendPayload = {
        suspendPayload?: {
          proposedLimits?: CategoryLimits;
          analysis?: AnalysisResult;
        };
        metadata?: {
          mastra?: {
            suspendPayload?: {
              proposedLimits?: CategoryLimits;
              analysis?: AnalysisResult;
            };
          };
        };
      };
      let parsed: SuspendPayload = {};
      try {
        parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as SuspendPayload;
      } catch {
        // Malformed suspend payload — fall through to the empty-state card
        // below rather than crashing the render.
      }
      const payload = parsed.metadata?.mastra?.suspendPayload ?? parsed.suspendPayload ?? {};
      return (
        <MonthlyReviewCard
          proposedLimits={payload.proposedLimits ?? {}}
          analysis={payload.analysis ?? emptyAnalysis}
          onApprove={() => resolve({ decision: "approve" })}
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
        const parsedAnalysis = parseToolResult<AnalysisResult>(
          result,
          emptyAnalysis,
        );
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

  useRenderTool(
    {
      name: "addTransaction",
      parameters: z.object({
        merchant: z.string().optional(),
        amount: z.number().optional(),
        type: z.enum(["income", "expense"]).optional(),
        category: CategorySchema.optional(),
        date: z.string().optional(),
      }),
      render: ({ status, result }) => (
        <AddTransactionResultCard
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
      name: "highlightCategory",
      description:
        "Visually point at a budget category in the dashboard. Does NOT filter or change any data. Only call this when the user explicitly asks to highlight, show, or point out a category (e.g. \"highlight Dining\") — never automatically just because a category came up while answering a question.",
      parameters: z.object({ category: CategorySchema.optional() }),
      handler: async ({ category }) => {
        setHighlightedCategory(category);
        return category
          ? `Highlighted ${category} in the dashboard.`
          : "Cleared the highlighted category.";
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "selectCategory",
      description:
        "Filter the Transactions list on the dashboard down to one category, exactly as if the user clicked that category's row. Omit category to clear the filter and show all transactions again.",
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

  useEffect(() => {
    if (highlightedCategory) {
      window.localStorage.setItem(
        HIGHLIGHTED_CATEGORY_STORAGE_KEY,
        highlightedCategory,
      );
    } else {
      window.localStorage.removeItem(HIGHLIGHTED_CATEGORY_STORAGE_KEY);
    }
  }, [highlightedCategory]);

  useAgentContext({
    description:
      "The month currently visible on the dashboard, any category the user has highlighted, and any category the Transactions list is currently filtered to",
    value: {
      visibleMonth,
      highlightedCategory: highlightedCategory ?? null,
      selectedCategory: selectedCategory ?? null,
    },
  });

  useConfigureSuggestions({
    available: "always",
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
              {new Date(`${visibleMonth}-01`).toLocaleDateString(undefined, {
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
                highlightedCategory={highlightedCategory}
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
