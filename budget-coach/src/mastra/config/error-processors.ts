import { StreamErrorRetryProcessor } from "@mastra/core/processors";

// Cerebras's free tier caps at 5 requests/minute; retry transient 429s
// with backoff instead of surfacing them to the user. A factory, not a
// shared instance, so each agent/scorer gets its own retry state.
export const createCerebrasRetryProcessor = () =>
  new StreamErrorRetryProcessor({
    retryUnknownErrors: true,
    maxRetries: 2,
    delayMs: ({ retryCount }) => Math.min(4000 * 2 ** retryCount, 20000),
  });
