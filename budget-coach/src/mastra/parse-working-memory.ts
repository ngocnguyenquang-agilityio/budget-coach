// Working memory is stored as free-form JSON text; parse defensively rather
// than trusting it's always well-formed (e.g. a prior write from the model's
// own updateWorkingMemory tool).
export function parseWorkingMemory(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
