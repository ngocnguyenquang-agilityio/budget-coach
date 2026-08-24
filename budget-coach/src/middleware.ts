import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const RESOURCE_ID_HEADER = "x-resource-id";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) {
    return NextResponse.next();
  }

  await auth.protect();
  const { userId } = await auth();
  if (!userId) {
    console.error(
      "[middleware] auth.protect() succeeded but userId is missing",
    );
    return NextResponse.redirect(new URL("/sign-in", req.url));
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(RESOURCE_ID_HEADER, userId);

  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
