// Working memory is stored as free-form JSON text. `raw === null` is the
// legitimate "no working memory yet" case and returns {}. A non-null `raw`
// that fails to parse is corruption, not emptiness — it throws rather than
// silently returning {}, because every caller treats {} as "user has no
// data" and would otherwise wipe categoryLimits/savingsPots/pendingApproval
// etc. for an existing user without any signal that something went wrong.
export const parseWorkingMemory = (raw: string | null): Record<string, unknown> => {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error("Working memory is corrupted (invalid JSON)", { cause: err });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Working memory is corrupted (not a JSON object)");
  }
  return parsed as Record<string, unknown>;
};
