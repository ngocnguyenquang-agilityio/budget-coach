import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createLocalAgents } from "@/agent";
import { getResourceId } from "@/mastra/get-resource-id";

const runtime = new CopilotRuntime({
  // Agents are constructed per-request (not once at module scope) so each
  // Mastra agent's `resourceId` matches the per-browser id middleware.ts
  // derives from the `resource_id` cookie — otherwise memory/tool writes get
  // scoped to the AG-UI thread id instead, diverging from what GET
  // /api/transactions reads.
  agents: ({ request }) => createLocalAgents(getResourceId(request)),
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        // Scoped to the per-browser resourceId set by src/middleware.ts, so
        // Intelligence thread history isolates the same way Mastra working
        // memory does — not a real auth identity.
        identifyUser: (request: Request) => ({
          id: getResourceId(request),
          name: "Budget Coach User",
        }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
