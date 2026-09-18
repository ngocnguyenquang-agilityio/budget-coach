import { NextResponse } from "next/server";
import { OBSERVABILITY_EVENTS } from "@/constants/observability";
import { reportError } from "@/lib/report-error";

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
      // Funnels through the shared reporter seam (console today; external
      // service when ERROR_REPORTING is enabled). Route handlers run outside
      // Mastra, so this is their only reporting path.
      reportError(error, {
        event: OBSERVABILITY_EVENTS.apiError,
        method: req.method,
        url: req.url,
      });
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
};
