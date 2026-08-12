export const PROMPT_INJECTION_PHRASES = [
  "ignore previous instructions",
  "ignore all previous instructions",
  "disregard your instructions",
  "reveal your system prompt",
  "you are now",
];

export const FINANCIAL_ADVICE_BLOCKED_PHRASES = [
  "should i invest",
  "which stocks",
  "is crypto a good",
  "should i buy stock",
  "pick a stock",
  "financial advisor",
];

// Output-side counterpart to FINANCIAL_ADVICE_BLOCKED_PHRASES (blocks
// investment-advice *questions* on the way in). This list flags the Coach's
// own *response* if it drifts into regulated-advice territory regardless of
// what the user asked — e.g. volunteering a stock tip.
export const REGULATED_ADVICE_KEYWORDS = [
  "you should invest",
  "i recommend investing",
  "buy this stock",
  "buy that stock",
  "good stock to buy",
  "invest in crypto",
  "cryptocurrency is a good",
  "index fund",
  "mutual fund",
];
