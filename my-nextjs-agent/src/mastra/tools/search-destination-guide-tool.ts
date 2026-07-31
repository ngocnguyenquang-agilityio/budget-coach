import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embed } from 'ai';
import { ollamaEmbedding } from '../model';
import { destinationGuidesVector, DESTINATION_GUIDES_INDEX } from '../vector-store';

export const searchDestinationGuideTool = createTool({
  id: 'search-destination-guide',
  description:
    "Search a curated destination guide knowledge base for facts about a specific city (neighborhoods, sights, local tips). Only covers a small, fixed set of cities — an empty result means this city isn't in the knowledge base, which is expected and not an error; fall back to general knowledge in that case.",
  inputSchema: z.object({
    city: z.string().describe('The exact city name to search guide content for, e.g. "Lisbon"'),
    query: z.string().describe('What to look for, e.g. "best neighborhoods for nightlife"'),
  }),
  outputSchema: z.object({
    results: z.array(z.string()),
  }),
  execute: async (inputData) => {
    const { city, query } = inputData;

    try {
      const { embedding } = await embed({ model: ollamaEmbedding, value: query });

      const matches = await destinationGuidesVector.query({
        indexName: DESTINATION_GUIDES_INDEX,
        queryVector: embedding,
        topK: 4,
        filter: { city },
      });

      return { results: matches.map(match => String(match.metadata?.text ?? '')) };
    } catch {
      // Missing index (seed script never run), embedding call failure, etc.
      // all degrade to "no guide content" rather than failing the agent's turn.
      return { results: [] };
    }
  },
});
