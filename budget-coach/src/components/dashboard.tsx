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
import { CategoryConfirmCard } from "@/components/category-confirm-card";
import { MonthlyReviewCard } from "@/components/monthly-review-card";
import {
  AddTransactionForm,
  type AddTransactionFormPrefill,
} from "@/components/add-transaction-form";
import { AddTransactionResultCard } from "@/components/add-transaction-result-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const emptyAnalysis: AnalysisResult = { categoryTotals: [], trailingSpend: 0 };

export const Dashboard = () => {
  const { agent, isReady } = useAgent({
    agentId: "coach",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  const state = (agent.state as BudgetState | undefined) ?? {};

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [highlightedCategory, setHighlightedCategory] = useState<
    Category | undefined
  >();
  const [formOpen, setFormOpen] = useState(false);
  const [formPrefill, setFormPrefill] = useState<AddTransactionFormPrefill>({});

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
    () => computeAnalysis(transactions, state.categoryLimits ?? {}),
    [transactions, state.categoryLimits],
  );

  // Gate 1 — pure frontend tool, no server suspend. The Coach calls this
  // (per its instructions) after categorizing a described purchase; on
  // confirm it's told to call addTransaction itself.
  useHumanInTheLoop(
    {
      name: "confirmCategory",
      description:
        "Ask the user to confirm the suggested category for a transaction before recording it.",
      parameters: z.object({
        merchant: z.string().optional(),
        amount: z.number().optional(),
        suggested: CategorySchema.optional(),
      }),
      render: ({ args, status, respond }) => (
        <CategoryConfirmCard
          merchant={args.merchant}
          amount={args.amount}
          suggested={args.suggested}
          status={status}
          respond={respond}
        />
      ),
    },
    [],
  );

  // Gate 2 — server-side Mastra suspend/resume via approveBudgetTool. The
  // suspend payload is nested under suspendPayload inside event.value, and
  // event.value may arrive as a JSON string rather than an object.
  useInterrupt({
    agentId: "coach",
    renderInChat: true,
    render: ({ event, resolve }) => {
      const raw = event.value ?? {};
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
        suspendPayload?: {
          proposedLimits?: CategoryLimits;
          analysis?: AnalysisResult;
        };
      };
      const payload = parsed.suspendPayload ?? {};
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
        category: CategorySchema.optional(),
      }),
      handler: async ({ merchant, amount, category }) => {
        setFormPrefill({ merchant, amount, category });
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
        "Highlight a budget category in the dashboard. UI only — does not change any data.",
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

  useAgentContext({
    description:
      "The month currently visible on the dashboard, and any category the user has highlighted",
    value: { visibleMonth, highlightedCategory: highlightedCategory ?? null },
  });

  useConfigureSuggestions({
    available: "always",
    suggestions: [
      { title: "Log a purchase", message: "I spent $40 at Trader Joe's." },
      {
        title: "Set a savings goal",
        message: "Set a savings goal of $2,000 by December.",
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
                Trailing 30-day spend
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                ${analysis.trailingSpend.toFixed(2)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                Savings goal
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {state.savingsGoal !== undefined
                  ? `$${state.savingsGoal.toFixed(2)}/mo`
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="col-span-2 md:col-span-1">
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
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <TransactionListCard transactions={transactions} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
