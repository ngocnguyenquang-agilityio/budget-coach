// Shown when the Coach finishes a turn without emitting any assistant text —
// gpt-oss-120b on Cerebras can burn its whole step budget on reasoning/tool
// calls and end with an empty content channel (see coach.ts:72-83). Used only
// when no tool produced a human-readable `message` to echo instead.
export const COACH_EMPTY_RESPONSE_FALLBACK =
  "Sorry — I finished working on that but didn't manage to put a reply together. It may still have gone through; ask me to summarize where things stand, or try again.";
