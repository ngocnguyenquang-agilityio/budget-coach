import { NextResponse } from "next/server";
import { OBSERVABILITY_EVENTS } from "@/constants/observability";

// Wraps a route handler so an unexpected throw (a DB failure, getResourceId's
// missing-header guard, etc.) becomes a logged, JSON-shaped 500 instead of
// Next.js's default framework error page.
export const withErrorHandling = <Context = { params: Promise<Record<string, never>> }>(
  handler: (req: Request, context: Context) => Promise<Response>,
) => {
  return async (req: Request, context: Context): Promise<Response> => {
    try {
      return await handler(req, context);
    } catch (error) {
      // Console-only: route handlers run outside Mastra, and logs don't reach
      // storage on LibSQL anyway — this just matches the shape used agent-side.
      console.error(
        JSON.stringify({
          event: OBSERVABILITY_EVENTS.apiError,
          method: req.method,
          url: req.url,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
};
