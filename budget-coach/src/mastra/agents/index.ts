import { Agent } from "@mastra/core/agent";
import { weatherTool } from "@/mastra/tools";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { model } from "@/mastra/model";
import { storage } from "@/mastra/storage";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: { weatherTool },
  model,
  instructions: "You are a helpful assistant.",
  memory: new Memory({
    storage,
    options: {
      workingMemory: {
        enabled: true,
        schema: AgentState,
        scope: "thread",
      },
    },
  }),
});

export { categorizerAgent } from "./categorizer";
export { analystAgent } from "./analyst";
export { coachAgent } from "./coach";
export { suggesterAgent } from "./suggester";
