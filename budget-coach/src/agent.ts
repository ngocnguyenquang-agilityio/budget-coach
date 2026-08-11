import { MastraAgent } from "@ag-ui/mastra";
import type { AbstractAgent } from "@ag-ui/client";
import { mastra } from "@/mastra";

/**
 * Every local Mastra agent, keyed by name — what the web route mounts.
 *
 * Unlike the HTTP-backed starters there is no agent server here: the agents run
 * in this process.
 */
export const createLocalAgents = (
  resourceId: string
): Record<string, AbstractAgent> => {
  return MastraAgent.getLocalAgents({ mastra, resourceId }) as Record<
    string,
    AbstractAgent
  >;
};
