// Converts unhandled throws into { success: false, error, code: "TOOL_ERROR" }, the shape the Coach prompt handles.

import { SpanType } from "@mastra/core/observability";
import { OBSERVABILITY_EVENTS } from "@/constants/observability";
import { reportError } from "@/lib/report-error";

// Bad preconditions (missing threadId, unregistered workflow, etc.) — kept distinct from a runtime failure.
export class ToolPreconditionError extends Error {}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyExecute<TInput, TOutput> = (input: TInput, context: any) => Promise<TOutput>;

// Logs an error and marks the current span as failed, so it shows up in Mastra Studio / AI tracing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const traceToolError = (context: any, err: unknown, code: string = "TOOL_ERROR") => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  context.observe.log("error", message, { code });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  context.tracingContext?.currentSpan?.error({
    error: err instanceof Error ? err : new Error(message),
    metadata: { event: OBSERVABILITY_EVENTS.toolFailure, code },
  });
  // Shared external-reporting seam (no-op until ERROR_REPORTING is enabled).
  reportError(err, { event: OBSERVABILITY_EVENTS.toolFailure, code });
};

// Like traceToolError, but for a per-item failure inside a batch that can still otherwise succeed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const traceToolEvent = (context: any, err: unknown, name: string, code: string = "TOOL_ERROR") => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  context.observe.log("error", message, { code });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  context.tracingContext?.currentSpan?.createEventSpan({
    name,
    type: SpanType.GENERIC,
    metadata: { event: OBSERVABILITY_EVENTS.toolFailure, code },
    output: { error: message },
  });
};

export const withToolErrorHandling = <TInput, TOutput>(
  execute: AnyExecute<TInput, TOutput>,
): AnyExecute<TInput, TOutput> =>
  async (input, context) => {
    try {
      return await execute(input, context);
    } catch (err) {
      if (err instanceof ToolPreconditionError) throw err;
      traceToolError(context, err);
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, code: "TOOL_ERROR" } as unknown as TOutput;
    }
  };
