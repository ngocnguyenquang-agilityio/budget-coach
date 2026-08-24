import { NextResponse } from "next/server";

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
      console.error("[api]", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
};
