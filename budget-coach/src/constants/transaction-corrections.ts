import type { CorrectionFailureReason } from "@/domain/transaction-correction";

// Most rows one edit/delete card may carry (ADR-0016). Past this the card is
// too long to genuinely review, and a confirmation nobody reads isn't a gate.
export const MAX_CORRECTION_ROWS = 25;

// User-facing reason shown on the card (and relayed by the Coach) for a row
// the corrections route refused.
export const CORRECTION_FAILURE_MESSAGES: Record<CorrectionFailureReason, string> = {
  not_found: "no longer exists",
  duplicate: "listed twice",
  stale: "changed since shown",
  transfer: "a savings-pot transfer — change it through the pot",
  pot_funded: "paid from a savings pot — change it through the pot",
  expected: "not confirmed yet — confirm it instead",
  scheduled_delete: "comes from a recurring payment — change the recurring payment instead",
  scheduled_period_move: "comes from a recurring payment, so it can't move to another month",
  no_changes: "nothing to change",
  empty_merchant: "the name can't be blank",
  invalid_amount: "the amount must be more than zero",
  invalid_date: "not a valid date",
  future_date: "the date is in the future",
  category_on_income: "income doesn't have a category",
  write_failed: "couldn't be saved",
};
