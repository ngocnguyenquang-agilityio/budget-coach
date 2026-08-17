import { NextResponse, type NextRequest } from "next/server";

const RESOURCE_ID_COOKIE = "resource_id";
const RESOURCE_ID_HEADER = "x-resource-id";

// Every visitor to this app shares one Mastra `resourceId` unless we assign
// one per browser here. Without this, working memory (savings goal, category
// limits), thread listings, and transactions would be shared across everyone
// hitting the app instead of scoped to the person using it.
export const middleware = (req: NextRequest) => {
  const existing = req.cookies.get(RESOURCE_ID_COOKIE)?.value;
  const resourceId = existing ?? crypto.randomUUID();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(RESOURCE_ID_HEADER, resourceId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (!existing) {
    response.cookies.set(RESOURCE_ID_COOKIE, resourceId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  return response;
};

// Page requests are matched too, not just /api/*. A first-time visitor's page
// load fires several API calls at once (threads, transactions, working memory,
// the CopilotKit handshake); if the cookie is only minted on /api/* then each
// of those arrives without one and mints a *different* resourceId, and only the
// last Set-Cookie survives. Everything written under a losing id is orphaned —
// the run persists a thread nobody can list. Matching the document means the
// cookie exists before any of those requests are made.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
