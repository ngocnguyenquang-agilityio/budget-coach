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

export const config = {
  matcher: ["/api/:path*", "/api/copilotkit/:path*"],
};
