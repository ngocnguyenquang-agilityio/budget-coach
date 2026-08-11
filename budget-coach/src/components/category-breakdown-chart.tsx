"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AnalysisResult } from "@/domain/analysis";
import { CATEGORY_COLORS } from "@/constants/chart-colors";

const ChartTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number }[];
}) => {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-xs shadow-sm">
      <span className="font-medium">{entry.name}</span>{" "}
      <span className="text-[var(--muted-foreground)]">
        ${Number(entry.value ?? 0).toFixed(2)}
      </span>
    </div>
  );
};

export const CategoryBreakdownChart = ({
  analysis,
}: {
  analysis: AnalysisResult;
}) => {
  const data = analysis.categoryTotals
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((entry) => ({ name: entry.category, value: entry.total }));

  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        No spending in the trailing 30 days.
      </p>
    );
  }

  const total = data.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="space-y-3">
      <div className="relative" style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={64}
              outerRadius={94}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={CATEGORY_COLORS[entry.name]}
                />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-[var(--muted-foreground)]">
            Total
          </span>
          <span className="text-lg font-semibold">${total.toFixed(0)}</span>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {data.map((entry) => (
          <li key={entry.name} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: CATEGORY_COLORS[entry.name] }}
            />
            <span className="text-[var(--muted-foreground)]">
              {entry.name}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
