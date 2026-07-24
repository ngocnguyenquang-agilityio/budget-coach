import { Agent } from "@mastra/core/agent";
import { MastraAgent } from "@ag-ui/mastra";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { google } from "@ai-sdk/google";
import { initialSessionState } from "./state/sessionState";

export const agent = new MastraAgent({
  resourceId: "cliExample",
  initialState: initialSessionState,
  agent: new Agent({
    id: "ag-ui-assistant",
    name: "AG-UI Assistant",
    instructions: `
      You are a helpful AI assistant. Be friendly, conversational, and helpful.
      Answer questions to the best of your ability and engage in natural conversation.

      For weather queries:
      - Always ask for a location if none is provided
      - Use the "weather" tool to fetch current weather data

      If the user asks you to open a link or visit a website, use the "openUrl" tool
      to open it in their default web browser. Always use full URLs (e.g., "https://www.google.com").
    `,
    model: google("gemini-3.5-flash"),
    memory: new Memory({
      storage: new LibSQLStore({
        id: "storage-memory",
        url: "file:./assistant.db",
      }),
    }),
  }),
  threadId: "main-conversation",
});
