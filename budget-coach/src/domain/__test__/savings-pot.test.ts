import { describe, expect, it } from "vitest";
import { computePotProgress, parsePots, potRate, type SavingsPot } from "../savings-pot";

const targetPot = (overrides: Partial<Extract<SavingsPot, { kind: "target" }>> = {}): SavingsPot => ({
  id: "p1",
  kind: "target",
  name: "Laptop",
  targetAmount: 1200,
  balance: 0,
  ...overrides,
});

const ratePot = (overrides: Partial<Extract<SavingsPot, { kind: "rate" }>> = {}): SavingsPot => ({
  id: "p2",
  kind: "rate",
  name: "General savings",
  ratePerMonth: 500,
  balance: 0,
  ...overrides,
});

const period = "2026-09";

describe("potRate", () => {
  it("is the stated rate for a rate-driven pot", () => {
    expect(potRate(ratePot(), period)).toBe(500);
  });

  // ADR-0013: no deadline means no months to divide by, so the pot claims
  // nothing until the user gives it one.
  it("is zero for a target pot with no deadline", () => {
    expect(potRate(targetPot({ balance: 300 }), period)).toBe(0);
  });

  it("divides the remaining amount across the months left, inclusive", () => {
    // $900 remaining by December, from September → Sep, Oct, Nov, Dec = 4.
    expect(potRate(targetPot({ balance: 300, deadline: "2026-12" }), period)).toBe(225);
  });

  // The rate is re-derived every Period, so falling behind raises it rather
  // than hiding the shortfall.
  it("rises as the deadline approaches with the target unmet", () => {
    const pot = targetPot({ balance: 300, deadline: "2026-12" });
    expect(potRate(pot, "2026-09")).toBe(225);
    expect(potRate(pot, "2026-11")).toBe(450);
    expect(potRate(pot, "2026-12")).toBe(900);
  });

  it("demands the whole remainder once the deadline has passed", () => {
    expect(potRate(targetPot({ balance: 300, deadline: "2026-08" }), period)).toBe(900);
  });

  // A completed pot releases its claim on the budget.
  it("is zero once the target is reached", () => {
    expect(potRate(targetPot({ balance: 1200, deadline: "2026-12" }), period)).toBe(0);
  });
});

describe("computePotProgress", () => {
  it("reports an open-ended target pot with no per-month figure", () => {
    const progress = computePotProgress(targetPot({ balance: 300 }), period);
    expect(progress.status).toBe("openEnded");
    expect(progress.pct).toBe(25);
    expect(progress.remaining).toBe(900);
    expect(progress.rate).toBe(0);
  });

  it("marks a pot complete once the target is reached, clamping pct at 100", () => {
    const progress = computePotProgress(targetPot({ balance: 1500 }), period);
    expect(progress.status).toBe("complete");
    expect(progress.pct).toBe(100);
    expect(progress.remaining).toBe(0);
  });

  it("tracks a dated pot as on track with its derived rate", () => {
    const progress = computePotProgress(targetPot({ balance: 300, deadline: "2026-12" }), period);
    expect(progress.status).toBe("onTrack");
    expect(progress.rate).toBe(225);
  });

  it("marks a dated pot behind once its deadline has passed while short", () => {
    const progress = computePotProgress(targetPot({ balance: 300, deadline: "2026-08" }), period);
    expect(progress.status).toBe("behind");
    expect(progress.rate).toBe(900);
  });

  it("reports a rate-driven pot as open-ended with no target figures", () => {
    const progress = computePotProgress(ratePot({ balance: 1000 }), period);
    expect(progress.status).toBe("openEnded");
    expect(progress.rate).toBe(500);
    expect(progress.balance).toBe(1000);
    expect(progress.targetAmount).toBeUndefined();
  });
});

describe("parsePots", () => {
  it("returns an empty list for a non-array value", () => {
    expect(parsePots(undefined)).toEqual([]);
    expect(parsePots({})).toEqual([]);
  });

  it("passes through pots already in the current shape", () => {
    const pots = [ratePot(), targetPot()];
    expect(parsePots(pots)).toEqual(pots);
  });

  // Pre-ADR-0013 shape: a target pot with a self-reported `savedSoFar`
  // instead of `kind`/`balance`.
  it("migrates a legacy target pot, mapping savedSoFar to balance", () => {
    const legacy = {
      id: "old-1",
      name: "Vacation",
      targetAmount: 2000,
      savedSoFar: 400,
      deadline: "2026-12",
    };

    expect(parsePots([legacy])).toEqual([
      {
        id: "old-1",
        kind: "target",
        name: "Vacation",
        targetAmount: 2000,
        balance: 400,
        deadline: "2026-12",
      },
    ]);
  });

  it("defaults a legacy pot's balance to zero when savedSoFar is missing", () => {
    const legacy = { id: "old-2", name: "Car", targetAmount: 5000 };
    const [migrated] = parsePots([legacy]);
    expect(migrated.balance).toBe(0);
  });

  // A malformed entry must never take down the whole budget read.
  it("drops entries that match neither the current nor legacy shape", () => {
    const good = ratePot();
    expect(parsePots([good, { garbage: true }, null, 42])).toEqual([good]);
  });
});
