// Wraps a tool's execute to convert unhandled throws into { success: false, error, code: "TOOL_ERROR" }, the shape the Coach prompt handles; ToolPreconditionError propagates unconverted so precondition bugs stay distinguishable from infra failures.

import { OBSERVABILITY_EVENTS } from "@/constants/observability";

// Thrown for bad preconditions (missing threadId, unregistered workflow, etc.) — never converted to the structured error shape, so it stays visibly distinct from a genuine runtime failure.
export class ToolPreconditionError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExecute<TInput, TOutput> = (input: TInput, context: any) => Promise<TOutput>;

export const withToolErrorHandling = <TInput, TOutput>(
  execute: AnyExecute<TInput, TOutput>,
): AnyExecute<TInput, TOutput> =>
  async (input, context) => {
    try {
      return await execute(input, context);
    } catch (err) {
      if (err instanceof ToolPreconditionError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      context.observe.log("error", message, { code: "TOOL_ERROR" });
      // Without this the swallowed { success: false } reads as a successful span.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      context.tracingContext?.currentSpan?.error({
        error: err instanceof Error ? err : new Error(message),
        metadata: { event: OBSERVABILITY_EVENTS.toolFailure, code: "TOOL_ERROR" },
      });
      return { success: false, error: message, code: "TOOL_ERROR" } as unknown as TOutput;
    }
  };
