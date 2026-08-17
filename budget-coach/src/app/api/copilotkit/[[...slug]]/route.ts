import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createLocalAgents } from "@/agent";
import { getResourceId } from "@/mastra/get-resource-id";
import { MastraReplayAgentRunner } from "@/mastra/agui-replay-runner";

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
  // CopilotKit Intelligence used to be wired up here whenever
  // COPILOTKIT_LICENSE_TOKEN was set. It cannot work on serverless: its
  // IntelligenceAgentRunner returns the HTTP response as soon as its WebSocket
  // to the gateway joins and then runs the agent in the background, which Vercel
  // freezes the instant the response is sent — every run died with
  // RUNNER_CONNECTION_DROPPED. Thread history now comes from Mastra memory in
  // LibSQL instead (see MastraReplayAgentRunner and /api/threads), which needs
  // no license and no long-lived server, so dev and production run the same path.
  runner: new MastraReplayAgentRunner(),
});

const handler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
