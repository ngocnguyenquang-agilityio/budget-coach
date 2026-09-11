import { describe, expect, it } from "vitest";
import { applyPeriodClose, computeAmendments, computePeriodClose } from "../period-close";
import type { SavingsPot } from "../savings-pot";

const period = "2026-09";

const rate = (id: string, name: string, ratePerMonth: number, balance = 0): SavingsPot => ({
  id,
  kind: "rate",
  name,
  ratePerMonth,
  balance,
});

const target = (
  id: string,
  name: string,
  targetAmount: number,
  deadline: string | undefined,
  balance = 0
): SavingsPot => ({
  id,
  kind: "target",
  name,
  targetAmount,
  balance,
  ...(deadline ? { deadline } : {}),
});

describe("computePeriodClose", () => {
  it("rolls net savings into unallocated, then lets each pot draw its rate", () => {
    const close = computePeriodClose({
      period,
      netSavings: 800,
      unallocated: 0,
      pots: [rate("a", "General savings", 500)],
    });

    expect(close.availableToAllocate).toBe(800);
    expect(close.allocations).toEqual([{ potId: "a", potName: "General savings", amount: 500 }]);
    expect(close.remainingUnallocated).toBe(300);
  });

  // Pro-rata, not first-come-first-served: a pot created earlier must not
  // starve one created later.
  it("splits pro-rata by rate when there isn't enough to go round", () => {
    const close = computePeriodClose({
      period,
      netSavings: 300,
      unallocated: 0,
      pots: [rate("a", "General", 300), rate("b", "Holiday", 100)],
    });

    expect(close.allocations).toEqual([
      { potId: "a", potName: "General", amount: 225 },
      { potId: "b", potName: "Holiday", amount: 75 },
    ]);
    expect(close.remainingUnallocated).toBe(0);
  });

  // ADR-0012: signed, never floored — an overspent month draws the balance
  // down rather than quietly reporting no change.
  it("carries a negative net savings straight through to unallocated", () => {
    const close = computePeriodClose({
      period,
      netSavings: -250,
      unallocated: 100,
      pots: [rate("a", "General", 500)],
    });

    expect(close.availableToAllocate).toBe(-150);
    expect(close.allocations).toEqual([]);
    expect(close.remainingUnallocated).toBe(-150);
  });

  it("ignores pots that claim nothing this period", () => {
    const close = computePeriodClose({
      period,
      netSavings: 500,
      unallocated: 0,
      // Open-ended target pot: no deadline, so no rate, so no claim.
      pots: [target("a", "Laptop", 1200, undefined)],
    });

    expect(close.allocations).toEqual([]);
    expect(close.remainingUnallocated).toBe(500);
  });
});

describe("applyPeriodClose", () => {
  it("adds each allocation to its pot and returns the leftover", () => {
    const pots = [rate("a", "General", 500, 100)];
    const result = applyPeriodClose(pots, [{ potId: "a", potName: "General", amount: 500 }], 800);

    expect(result.pots[0].balance).toBe(600);
    expect(result.unallocated).toBe(300);
  });

  // Overshoot stays in Unallocated rather than inflating a pot past its
  // target — the money isn't lost, it's just not spoken for.
  it("caps a target pot at its target and leaves the excess unallocated", () => {
    const pots = [target("a", "Laptop", 1200, "2026-12", 1000)];
    const result = applyPeriodClose(pots, [{ potId: "a", potName: "Laptop", amount: 500 }], 500);

    expect(result.pots[0].balance).toBe(1200);
    expect(result.unallocated).toBe(300);
  });

  it("leaves pots with no allocation untouched", () => {
    const pots = [rate("a", "General", 500, 100), rate("b", "Holiday", 200, 50)];
    const result = applyPeriodClose(pots, [{ potId: "a", potName: "General", amount: 100 }], 100);

    expect(result.pots[1].balance).toBe(50);
    expect(result.unallocated).toBe(0);
  });
});

describe("computeAmendments", () => {
  it("returns a positive delta for a backdated income transaction", () => {
    const amendments = computeAmendments({
      pending: [{ period: "2026-07", netSavingsAtClose: 500 }],
      revisedNetSavings: () => 550,
    });

    expect(amendments).toEqual([
      { period: "2026-07", previousNetSavings: 500, revisedNetSavings: 550, delta: 50 },
    ]);
  });

  // Signed, not floored — the amendment counterpart to computePeriodClose's
  // own negative-net-savings behavior (ADR-0012/ADR-0015).
  it("returns a negative delta for a backdated expense, signed not floored", () => {
    const amendments = computeAmendments({
      pending: [{ period: "2026-07", netSavingsAtClose: 500 }],
      revisedNetSavings: () => 420,
    });

    expect(amendments[0].delta).toBe(-80);
  });

  it("returns a zero delta for an unchanged period", () => {
    const amendments = computeAmendments({
      pending: [{ period: "2026-07", netSavingsAtClose: 500 }],
      revisedNetSavings: () => 500,
    });

    expect(amendments[0].delta).toBe(0);
  });

  it("returns an empty array for no pending amendments", () => {
    expect(computeAmendments({ pending: [], revisedNetSavings: () => 0 })).toEqual([]);
  });

  it("sorts multiple entries by period ascending", () => {
    const amendments = computeAmendments({
      pending: [
        { period: "2026-08", netSavingsAtClose: 100 },
        { period: "2026-06", netSavingsAtClose: 200 },
        { period: "2026-07", netSavingsAtClose: 300 },
      ],
      revisedNetSavings: (period) => (period === "2026-08" ? 150 : period === "2026-06" ? 200 : 300),
    });

    expect(amendments.map((a) => a.period)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
});
