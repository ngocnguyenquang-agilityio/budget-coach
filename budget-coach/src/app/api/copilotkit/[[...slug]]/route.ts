import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createLocalAgents } from "@/agent";
import { getResourceId } from "@/mastra/get-resource-id";
import { threadNamingHooks } from "@/mastra/thread-naming";

export const runtime = "nodejs";
// Vercel's default function timeout (10s) is too short for a Gemini-backed
// agent turn that orchestrates sub-agents and tool calls; 60s is the ceiling
// on the Hobby plan.
export const maxDuration = 60;

const copilotRuntime = new CopilotRuntime({
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
        // The built-in feature sends its title-format instruction as a
        // system-role message on the AG-UI agent clone, but @ag-ui/mastra's
        // message converter drops system-role messages — the model never
        // sees the instruction and title generation fails almost every
        // time. threadNamingHooks (src/mastra/thread-naming.ts) replaces it
        // with a direct agent.generate() call, which applies system
        // messages correctly.
        generateThreadNames: false,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  hooks: threadNamingHooks,
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
