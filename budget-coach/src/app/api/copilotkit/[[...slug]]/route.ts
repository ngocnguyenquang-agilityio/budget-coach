import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createLocalAgents } from "@/agent";
import { getResourceId } from "@/mastra/get-resource-id";
import { MastraReplayAgentRunner } from "@/mastra/agui-replay-runner";

export const runtime = "nodejs";
// 60s: the max allowed on Vercel's Hobby plan, needed for multi-agent turns.
export const maxDuration = 60;

const copilotRuntime = new CopilotRuntime({
  // Per-request so resourceId matches the cookie middleware.ts derives it from.
  agents: ({ request }) => createLocalAgents(getResourceId(request)),
  // CopilotKit Intelligence doesn't work on serverless (Vercel freezes the
  // instance before its background run finishes); replay from Mastra/LibSQL instead.
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
