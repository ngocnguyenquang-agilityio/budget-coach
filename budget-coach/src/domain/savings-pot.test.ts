import { describe, expect, it } from "vitest";
import { computePotProgress, type SavingsPot } from "./savings-pot";

const pot = (overrides: Partial<SavingsPot> = {}): SavingsPot => ({
  id: "p1",
  name: "Laptop",
  targetAmount: 1200,
  savedSoFar: 0,
  ...overrides,
});

describe("computePotProgress", () => {
  const period = "2026-09";

  it("reports open-ended progress with no per-month figure", () => {
    const progress = computePotProgress(pot({ savedSoFar: 300 }), period);
    expect(progress.status).toBe("onTrack");
    expect(progress.pct).toBe(25);
    expect(progress.remaining).toBe(900);
    expect(progress.requiredPerMonth).toBeUndefined();
  });

  it("marks a pot complete once the target is reached, clamping pct at 100", () => {
    const progress = computePotProgress(pot({ savedSoFar: 1500 }), period);
    expect(progress.status).toBe("complete");
    expect(progress.pct).toBe(100);
    expect(progress.remaining).toBe(0);
  });

  it("divides the remaining amount across the months left (inclusive) for a dated pot", () => {
    // $900 remaining by December, from September → Sep, Oct, Nov, Dec = 4 months.
    const progress = computePotProgress(pot({ savedSoFar: 300, deadline: "2026-12" }), period);
    expect(progress.status).toBe("onTrack");
    expect(progress.requiredPerMonth).toBe(225);
  });

  it("marks a dated pot behind once its deadline has passed while short", () => {
    const progress = computePotProgress(pot({ savedSoFar: 300, deadline: "2026-08" }), period);
    expect(progress.status).toBe("behind");
    // The whole remaining amount is needed now.
    expect(progress.requiredPerMonth).toBe(900);
  });
});
