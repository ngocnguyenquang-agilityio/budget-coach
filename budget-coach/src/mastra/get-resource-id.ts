// Set by src/middleware.ts on every /api/* request — a per-browser id
// scoping Mastra memory (working memory, thread listings) and transactions
// to the visitor making the request instead of sharing one resource across
// everyone.
export function getResourceId(req: Request): string {
  const resourceId = req.headers.get("x-resource-id");

  if (!resourceId) {
    throw new Error("Missing x-resource-id header — request did not go through middleware");
  }

  return resourceId;
}
