import { LibSQLVector } from '@mastra/libsql';

export const DESTINATION_GUIDES_INDEX = 'destination_guides';

// nomic-embed-text's embedding output size — must match whatever's
// actually pulled via `ollama pull nomic-embed-text`.
export const DESTINATION_GUIDES_DIMENSION = 768;

export const destinationGuidesVector = new LibSQLVector({
  id: 'destination-guides-vector',
  // Same mastra.db file (and same Turso DB when configured) as the rest of
  // the app's storage — a separate table within it, not a separate file.
  url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});
