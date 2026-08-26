import { Mastra } from "@mastra/core/mastra";
import { weatherAgent, categorizerAgent, analystAgent, coachAgent, suggesterAgent } from "./agents";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { storage } from "./storage";
import { observability } from "./observability";
import { monthlyReviewWorkflow } from "./workflows/monthly-review-workflow";
import { categorizerAccuracyScorer } from "./scorers/categorizer-accuracy";
import { coachScopeScorer } from "./scorers/coach-scope";
import { adjustmentReasonablenessScorer } from "./scorers/adjustment-reasonableness";

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

export const mastra = new Mastra({
  agents: {
    default: weatherAgent,
    categorizer: categorizerAgent,
    analyst: analystAgent,
    coach: coachAgent,
    suggester: suggesterAgent,
  },
  workflows: {
    monthlyReviewWorkflow,
  },
  scorers: {
    categorizerAccuracy: categorizerAccuracyScorer,
    coachScope: coachScopeScorer,
    adjustmentReasonableness: adjustmentReasonablenessScorer,
  },
  storage,
  observability,
  logger: new ConsoleLogger({
    level: LOG_LEVEL,
  }),
});
