import jsonpatch from "fast-json-patch"
const { compare } = jsonpatch
import { z } from "zod"

/**
 * SessionState — the shared state contract between the agent (backend) and
 * the CLI (frontend). Both sides read/write the *same* object: the backend
 * mutates it by emitting STATE_SNAPSHOT / STATE_DELTA events, the frontend
 * mutates it by calling `agent.setState(...)`. The AG-UI SDK is responsible
 * for applying both event types onto `agent.state` -- neither side patches
 * `agent.state` directly.
 *
 * This models a simple "session dashboard": a running record of everything
 * the assistant's tools have done in this conversation.
 */
export const SessionStateSchema = z.object({
  /** Number of user turns processed so far. */
  messageCount: z.number().default(0),
  /** Appended each time the client-side weather tool resolves. */
  weatherLookups: z
    .array(
      z.object({
        location: z.string(),
        summary: z.string(),
        at: z.string(), // ISO timestamp
      })
    )
    .default([]),
  /** Appended each time the client-side calculate tool resolves. */
  calculations: z
    .array(
      z.object({
        expression: z.string(),
        result: z.string(),
        at: z.string(), // ISO timestamp
      })
    )
    .default([]),
  /** Appended each time the client-side openUrl tool actually opens a URL. */
  openedUrls: z.array(z.string()).default([]),
  /** ISO timestamp of the last state mutation, from either side. */
  lastUpdated: z.string().nullable().default(null),
})

export type SessionState = z.infer<typeof SessionStateSchema>

export const initialSessionState: SessionState = SessionStateSchema.parse({})

/**
 * Derives the RFC 6902 JSON Patch ops between two state snapshots via
 * `fast-json-patch`'s `compare`, rather than hand-writing ops per call site.
 * This is the "cheap incremental update" half of the sync story (a
 * STATE_DELTA); see docs/state-sync.md.
 */
export const diffSessionState = (before: SessionState, after: SessionState) => compare(before, after)
