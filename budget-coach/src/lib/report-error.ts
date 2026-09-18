// The single chokepoint every server-side error path funnels through (API
// route wrapper, tool error tracing, the Coach run() stream). Today it logs to
// the console — the behavior these call sites already had — and, when
// ERROR_REPORTING is enabled, also hands the error to a forwarding hook. That
// keeps wiring a real external service (Sentry, a logging pipeline, …) a
// one-function change instead of touching every call site, without pulling in
// any third-party dependency here yet.
export type ErrorContext = Record<string, unknown>;

// The seam a real reporter drops into. Intentionally a no-op body for now.
const forwardToReporter = (_error: Error, _context: ErrorContext): void => {
  // e.g. Sentry.captureException(_error, { extra: _context });
};

export const reportError = (error: unknown, context: ErrorContext = {}): void => {
  const normalized = error instanceof Error ? error : new Error(String(error));

  console.error(
    JSON.stringify({
      error: normalized.message,
      stack: normalized.stack,
      ...context,
    }),
  );

  if (process.env.ERROR_REPORTING === "on") {
    forwardToReporter(normalized, context);
  }
};
