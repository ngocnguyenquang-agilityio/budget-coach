import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse, type NextFetchEvent } from "next/server";

// NextResponse.next({ request: { headers } }) doesn't expose the forwarded
// request directly; Next encodes the overridden headers onto the response
// itself under this prefix for the edge runtime to replay downstream.
const FORWARDED_HEADER_PREFIX = "x-middleware-request-";

const forwardedHeader = (res: Response, name: string): string | null => {
  return res.headers.get(`${FORWARDED_HEADER_PREFIX}${name}`);
};

// Controllable per-test auth state, read by the mocked `auth()`/`auth.protect()`.
const authState: { userId: string | null } = { userId: null };

// Sentinel thrown by the mocked `auth.protect()` to unwind out of the handler,
// mirroring how Clerk's real protect() aborts the handler and lets
// clerkMiddleware's wrapper produce the redirect — code after protect() must
// never run for a signed-out request.
const PROTECT_REDIRECT = Symbol("protect-redirect");

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware:
    (handler: (auth: unknown, req: NextRequest) => Promise<Response>) =>
    async (req: NextRequest) => {
      const auth = async () => ({ userId: authState.userId });
      auth.protect = async () => {
        if (!authState.userId) throw PROTECT_REDIRECT;
      };

      try {
        return await handler(auth, req);
      } catch (e) {
        if (e === PROTECT_REDIRECT) {
          return NextResponse.redirect(new URL("/sign-in", req.url));
        }
        throw e;
      }
    },
  createRouteMatcher: (patterns: string[]) => (req: NextRequest) => {
    const regexes = patterns.map((p) => new RegExp(`^${p.replace("(.*)", ".*")}$`));
    return regexes.some((re) => re.test(req.nextUrl.pathname));
  },
}));

const { default: middleware } = await import("./middleware");

// The real `NextMiddleware` type takes a NextFetchEvent second arg and can
// return undefined; our middleware always returns a Response, and these
// tests never touch the event, so a stub satisfies the type.
const runMiddleware = async (req: NextRequest): Promise<Response> => {
  const res = await middleware(req, {} as NextFetchEvent);
  if (!res) throw new Error("middleware returned no response");
  return res;
};

describe("middleware", () => {
  afterEach(() => {
    authState.userId = null;
  });

  it("forwards x-resource-id set to the authenticated Clerk userId", async () => {
    authState.userId = "user_abc123";

    const req = new NextRequest("http://localhost/api/threads");
    const res = await runMiddleware(req);

    expect(forwardedHeader(res, "x-resource-id")).toBe("user_abc123");
  });

  it("redirects an unauthenticated request to a protected route, without forwarding x-resource-id", async () => {
    authState.userId = null;

    const req = new NextRequest("http://localhost/");
    const res = await runMiddleware(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/sign-in");
    expect(forwardedHeader(res, "x-resource-id")).toBeNull();
  });

  it("lets an unauthenticated request reach /sign-in and /sign-up", async () => {
    authState.userId = null;

    for (const path of ["/sign-in", "/sign-up"]) {
      const req = new NextRequest(`http://localhost${path}`);
      const res = await runMiddleware(req);

      expect(res.headers.get("location")).toBeNull();
      expect(forwardedHeader(res, "x-resource-id")).toBeNull();
    }
  });
});
