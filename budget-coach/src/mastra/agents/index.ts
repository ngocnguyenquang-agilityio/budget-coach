import { Agent } from "@mastra/core/agent";
import { weatherTool } from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { model } from "@/mastra/model";
import { promptInjectionGuardrail, financialAdviceGuardrail } from "@/mastra/guardrails";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: { weatherTool },
  model,
  instructions: "You are a helpful assistant.",
  // TODO(Day 3): move to the Coach agent once it exists; kept here for now so
  // the guardrails are testable against the only registered agent.
  inputProcessors: [promptInjectionGuardrail, financialAdviceGuardrail],
  memory: new Memory({
    storage: new LibSQLStore({
      id: "weather-agent-memory",
      url: "file::memory:",
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
        scope: "thread",
      },
    },
  }),
});
