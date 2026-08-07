import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

// NextResponse.next({ request: { headers } }) doesn't expose the forwarded
// request directly; Next encodes the overridden headers onto the response
// itself under this prefix for the edge runtime to replay downstream.
const FORWARDED_HEADER_PREFIX = "x-middleware-request-";

function forwardedHeader(res: ReturnType<typeof middleware>, name: string): string | null {
  return res.headers.get(`${FORWARDED_HEADER_PREFIX}${name}`);
}

describe("middleware resourceId assignment", () => {
  it("assigns two different browsers (no existing cookie) two different resourceIds", () => {
    const reqA = new NextRequest("http://localhost/api/copilotkit/foo");
    const reqB = new NextRequest("http://localhost/api/copilotkit/foo");

    const resA = middleware(reqA);
    const resB = middleware(reqB);

    const idA = forwardedHeader(resA, "x-resource-id");
    const idB = forwardedHeader(resB, "x-resource-id");

    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
    expect(idA).toBe(resA.cookies.get("resource_id")?.value);
    expect(idB).toBe(resB.cookies.get("resource_id")?.value);
  });

  it("reuses the existing resource_id cookie instead of minting a new one", () => {
    const req = new NextRequest("http://localhost/api/copilotkit/foo", {
      headers: { cookie: "resource_id=existing-id" },
    });

    const res = middleware(req);

    expect(res.cookies.get("resource_id")).toBeUndefined();
    expect(forwardedHeader(res, "x-resource-id")).toBe("existing-id");
  });
});
