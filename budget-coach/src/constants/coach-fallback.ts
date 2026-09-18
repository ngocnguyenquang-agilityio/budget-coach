// Shown when the Coach finishes a turn without emitting any assistant text —
// gpt-oss-120b on Cerebras can burn its whole step budget on reasoning/tool
// calls and end with an empty content channel (see coach.ts:72-83). Used only
// when no tool produced a human-readable `message` to echo instead.
export const COACH_EMPTY_RESPONSE_FALLBACK =
  "Sorry — I finished working on that but didn't manage to put a reply together. It may still have gone through; ask me to summarize where things stand, or try again.";

// Shown when the turn ends in a genuine error (a RUN_ERROR after the Cerebras
// retries are exhausted) with no assistant text — otherwise the stream just
// closes and the user sees the reply silently stop. Deliberately worded as a
// failure the user can act on, distinct from COACH_EMPTY_RESPONSE_FALLBACK
// (which implies the work may have gone through): a real error must not read
// like a successful-but-empty reply.
export const COACH_ERROR_FALLBACK =
  "Something went wrong on my end and I couldn't complete that. Nothing was saved from this message — please try again in a moment.";
