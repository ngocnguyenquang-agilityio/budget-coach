import { potRate, type SavingsPot } from "./savings-pot";

export interface PotAllocation {
  potId: string;
  potName: string;
  amount: number;
}

export interface PeriodClose {
  period: string;
  // Signed: a Period of overspending draws the Savings Balance down
  // (ADR-0012). Never floored at zero — a balance that only ever rises is a
  // lie the moment someone overspends.
  netSavings: number;
  // Unallocated after the roll-up lands but before pots draw from it.
  availableToAllocate: number;
  allocations: PotAllocation[];
  // What stays in Unallocated once every pot has drawn its rate.
  remainingUnallocated: number;
}

// Proposes one Period's close: roll the Period's signed Net Savings into
// Unallocated, then let each pot draw its monthly rate from it.
//
// The user confirms (and may edit) this before it commits — Period Close is
// the one moment the app moves the user's money, and it rides the Monthly
// Review's existing approval rather than adding a second one (ADR-0013).
//
// When Unallocated can't cover every pot's rate, pots draw **pro-rata by
// rate** rather than first-come-first-served, so a pot created earlier doesn't
// starve one created later.
export const computePeriodClose = ({
  period,
  netSavings,
  unallocated,
  pots,
}: {
  period: string;
  netSavings: number;
  unallocated: number;
  pots: SavingsPot[];
}): PeriodClose => {
  const availableToAllocate = round(unallocated + netSavings);

  // Nothing to hand out — and a negative Unallocated is left as-is rather
  // than clawed back out of pots. Money already allocated to a pot has been
  // set aside on purpose; an overspent month eats the unallocated remainder
  // first and simply goes negative if there isn't one.
  if (availableToAllocate <= 0) {
    return { period, netSavings, availableToAllocate, allocations: [], remainingUnallocated: availableToAllocate };
  }

  const rates = pots
    .map((pot) => ({ pot, rate: potRate(pot, period) }))
    .filter((entry) => entry.rate > 0);

  const totalRate = rates.reduce((total, entry) => total + entry.rate, 0);
  if (totalRate === 0) {
    return { period, netSavings, availableToAllocate, allocations: [], remainingUnallocated: availableToAllocate };
  }

  const scale = totalRate <= availableToAllocate ? 1 : availableToAllocate / totalRate;

  const allocations = rates
    .map(({ pot, rate }) => ({ potId: pot.id, potName: pot.name, amount: round(rate * scale) }))
    .filter((allocation) => allocation.amount > 0);

  const allocated = allocations.reduce((total, allocation) => total + allocation.amount, 0);

  return {
    period,
    netSavings,
    availableToAllocate,
    allocations,
    remainingUnallocated: round(availableToAllocate - allocated),
  };
};

// Applies a (possibly user-edited) close to the pots, capping each target pot
// at its target so an allocation can never overshoot into a balance the pot
// doesn't need. Overshoot stays in Unallocated.
export const applyPeriodClose = (
  pots: SavingsPot[],
  allocations: PotAllocation[],
  availableToAllocate: number
): { pots: SavingsPot[]; unallocated: number } => {
  const byId = new Map(allocations.map((allocation) => [allocation.potId, allocation.amount]));
  let spent = 0;

  const next = pots.map((pot) => {
    const requested = byId.get(pot.id) ?? 0;
    if (requested <= 0) return pot;

    const room = pot.kind === "target" ? Math.max(0, pot.targetAmount - pot.balance) : Infinity;
    const amount = round(Math.min(requested, room));
    if (amount <= 0) return pot;

    spent += amount;
    return { ...pot, balance: round(pot.balance + amount) };
  });

  return { pots: next, unallocated: round(availableToAllocate - spent) };
};

const round = (value: number): number => Math.round(value * 100) / 100;
