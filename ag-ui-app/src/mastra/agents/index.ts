import { google } from "@ai-sdk/google";
import { Agent } from "@mastra/core/agent";
import { weatherTool } from "@/mastra/tools";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";
import { Memory } from "@mastra/memory";
import { AgUiAssistantStateSchema } from "@/lib/agUiAssistantState";

export const AgentState = z.object({
  proverbs: z.array(z.string()).default([]),
});

export const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  tools: { weatherTool },
  model: google("gemini-3.5-flash"),
  instructions: "You are a helpful assistant.",
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

export const agUiAssistant = new Agent({
  id: "ag-ui-assistant",
  name: "AG-UI Assistant",
  tools: { weatherTool },
  model: google("gemini-3.5-flash"),
  instructions: `
    You are a helpful AI assistant. Be friendly, conversational, and helpful.
    Answer questions to the best of your ability and engage in natural conversation.

    For weather queries:
    - Always ask for a location if none is provided
    - Use the weatherTool to fetch current weather data

    For any arithmetic, use the "calculate" tool instead of computing by hand.

    If the user asks to open a link or visit a website, use the "openUrl" tool
    to open it in a new browser tab. Always use full URLs (e.g., "https://www.google.com").
  `,
  memory: new Memory({
    storage: new LibSQLStore({
      id: "ag-ui-assistant-memory",
      url: "file::memory:",
    }),
    options: {
      workingMemory: {
        enabled: true,
        schema: AgUiAssistantStateSchema,
        // "thread" (not "resource"): the tool-side write path
        // (weatherTool, via Memory.updateWorkingMemory) only ever has a
        // threadId available, not a resourceId.
        scope: "thread",
      },
    },
  }),
});
