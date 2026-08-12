import type { ScorerRunInputForAgent } from "@mastra/core/evals";

// Shared across agent-scorer tests (categorizer-accuracy, coach-scope) that
// only read `run.output` — the input side just needs to satisfy
// ScorerRunInputForAgent's shape.
export const EMPTY_SCORER_INPUT: ScorerRunInputForAgent = {
  inputMessages: [],
  rememberedMessages: [],
  systemMessages: [],
  taggedSystemMessages: {},
};
