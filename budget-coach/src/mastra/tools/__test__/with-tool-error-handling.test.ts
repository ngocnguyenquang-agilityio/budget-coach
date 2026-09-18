import { describe, expect, it, vi } from "vitest";
import { withToolErrorHandling, ToolPreconditionError } from "../with-tool-error-handling";

// Minimal stand-in for the Mastra tool context traceToolError reaches into
// (context.observe.log + context.tracingContext?.currentSpan?.error). No span,
// so the optional-chained span call is a no-op.
const fakeContext = () => ({ observe: { log: vi.fn() }, tracingContext: undefined });

describe("withToolErrorHandling", () => {
  it("returns the wrapped result unchanged on success", async () => {
    const wrapped = withToolErrorHandling(async () => ({ results: ["ok"] }));
    const result = await wrapped({}, fakeContext());
    expect(result).toEqual({ results: ["ok"] });
  });

  // The #18 guarantee: a genuine runtime throw (e.g. a Cerebras outage inside
  // categorizeBatchTool) surfaces as a legible failure, NOT a silent
  // success-shaped result the Coach would report as if it worked.
  it("converts a runtime throw into { success: false, code: 'TOOL_ERROR' }", async () => {
    const context = fakeContext();
    const wrapped = withToolErrorHandling(async () => {
      throw new Error("Cerebras request failed");
    });

    const result = await wrapped({}, context);

    expect(result).toEqual({ success: false, error: "Cerebras request failed", code: "TOOL_ERROR" });
    expect(context.observe.log).toHaveBeenCalledWith("error", "Cerebras request failed", { code: "TOOL_ERROR" });
  });

  // Precondition bugs (missing threadId, unregistered workflow) must stay
  // distinguishable from runtime failures, so they re-throw rather than
  // degrade to the { success: false } business-error shape.
  it("re-throws a ToolPreconditionError", async () => {
    const wrapped = withToolErrorHandling(async () => {
      throw new ToolPreconditionError("missing threadId");
    });

    await expect(wrapped({}, fakeContext())).rejects.toThrow("missing threadId");
  });
});
