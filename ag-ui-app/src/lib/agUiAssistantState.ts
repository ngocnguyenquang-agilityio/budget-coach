import { z } from "zod";

/**
 * Shared state contract for the agUiAssistant agent's working memory —
 * the web port of my-ag-ui-client's SessionState (src/state/sessionState.ts).
 * Both the server (weatherTool, via Memory.updateWorkingMemory) and the
 * client (agent.setState, via useAgent) read/write this same shape.
 */
export const AgUiAssistantStateSchema = z.object({
  /** Appended each time the server-side weatherTool resolves. */
  weatherLookups: z
    .array(
      z.object({
        location: z.string(),
        summary: z.string(),
        at: z.string(), // ISO timestamp
      }),
    )
    .default([]),
  /** Appended each time the client-side "calculate" tool resolves. */
  calculations: z
    .array(
      z.object({
        expression: z.string(),
        result: z.string(),
        at: z.string(), // ISO timestamp
      }),
    )
    .default([]),
  /** Appended each time the "openUrl" human-in-the-loop tool actually opens a URL. */
  openedUrls: z.array(z.string()).default([]),
  /** ISO timestamp of the last state mutation, from either side. */
  lastUpdated: z.string().nullable().default(null),
});

export type AgUiAssistantState = z.infer<typeof AgUiAssistantStateSchema>;

export const initialAgUiAssistantState: AgUiAssistantState =
  AgUiAssistantStateSchema.parse({});
