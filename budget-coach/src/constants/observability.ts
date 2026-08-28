// Filterable `metadata.event` values. Every countable observability event uses
// one of these, so `listTraces({ filters: { metadata: { event } } })` is the
// single query shape for all of them.
export const OBSERVABILITY_EVENTS = {
  toolFailure: "tool-failure",
  guardrailBlock: "guardrail-block",
  apiError: "api-error",
} as const;

export type ObservabilityEvent = (typeof OBSERVABILITY_EVENTS)[keyof typeof OBSERVABILITY_EVENTS];
