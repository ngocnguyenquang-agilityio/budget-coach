import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const RESOURCE_ID_HEADER = "x-resource-id";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

// resourceId scoping (working memory, thread listings, transactions) is
// keyed directly off the authenticated Clerk userId — see ADR-0004. No
// mapping table: whatever string lands in x-resource-id is what every
// downstream consumer (getResourceId, resolveResourceId) trusts.
export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  await auth.protect();
  const { userId } = await auth();

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(RESOURCE_ID_HEADER, userId!);

  return NextResponse.next({ request: { headers: requestHeaders } });
});

// Page requests are matched too, not just /api/*. A first-time visitor's page
// load fires several API calls at once (threads, transactions, working memory,
// the CopilotKit handshake); every one of them needs x-resource-id attached or
// getResourceId throws. Matching the document means auth runs before any of
// those requests reach a route handler.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
