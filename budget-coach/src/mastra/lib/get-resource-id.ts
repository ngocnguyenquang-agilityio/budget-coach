// Set by src/middleware.ts on every /api/* request — a per-browser id
// scoping Mastra memory (working memory, thread listings) and transactions
// to the visitor making the request instead of sharing one resource across
// everyone.
export const getResourceId = (req: Request): string => {
  const resourceId = req.headers.get("x-resource-id");

  if (!resourceId) {
    throw new Error("Missing x-resource-id header — request did not go through middleware");
  }

  return resourceId;
};

// Tools resolve resourceId two ways: `context.agent.resourceId` when the
// caller is an agent invoked with `memory.resource` set (the Coach's own
// tools), or `context.requestContext` when a tool is invoked by a memory-less
// sub-agent (e.g. the Analyst, called by the Coach's analyze-spending tool,
// which threads resourceId through requestContext rather than trusting the
// model to pass it as a normal argument).
export const resolveResourceId = (context: {
  agent?: { resourceId?: string };
  requestContext?: { get(key: string): unknown };
}): string => {
  const resourceId =
    context.agent?.resourceId ?? (context.requestContext?.get("resourceId") as string | undefined);

  if (!resourceId) {
    throw new Error(
      "Missing resourceId — call the agent with memory.resource set, or pass resourceId via requestContext"
    );
  }

  return resourceId;
};
