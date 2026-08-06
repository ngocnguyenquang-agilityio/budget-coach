import { Mastra } from "@mastra/core/mastra";
import { weatherAgent } from "./agents";
import { ConsoleLogger, LogLevel } from "@mastra/core/logger";
import { storage } from "./storage";
import { observability } from "./observability";

const LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || "info";

export const mastra = new Mastra({
  agents: {
    default: weatherAgent,
  },
  storage,
  observability,
  logger: new ConsoleLogger({
    level: LOG_LEVEL,
  }),
});
