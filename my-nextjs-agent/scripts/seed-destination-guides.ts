import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { ollamaEmbedding } from '../src/mastra/model';
import {
  destinationGuidesVector,
  DESTINATION_GUIDES_INDEX,
  DESTINATION_GUIDES_DIMENSION,
} from '../src/mastra/vector-store';

const CITIES: { city: string; wikivoyageTitle: string }[] = [
  { city: 'Lisbon', wikivoyageTitle: 'Lisbon' },
  { city: 'Tokyo', wikivoyageTitle: 'Tokyo' },
  { city: 'Paris', wikivoyageTitle: 'Paris' },
  { city: 'Bangkok', wikivoyageTitle: 'Bangkok' },
  { city: 'New York', wikivoyageTitle: 'New York City' },
];

// Wikivoyage articles run 60k-180k characters; truncating keeps seeding
// fast (a handful of chunks per city instead of hundreds) while keeping
// the most itinerary-relevant intro/overview sections.
const MAX_EXTRACT_CHARS = 8000;

async function fetchWikivoyageExtract(title: string): Promise<string | null> {
  const url = `https://en.wikivoyage.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&titles=${encodeURIComponent(title)}`;
  const response = await fetch(url);
  if (!response.ok) return null;

  const data = (await response.json()) as {
    query: { pages: Record<string, { extract?: string }> };
  };
  const extract = Object.values(data.query.pages)[0]?.extract;
  return extract && extract.trim().length > 0 ? extract.slice(0, MAX_EXTRACT_CHARS) : null;
}

async function seedCity(city: string, wikivoyageTitle: string) {
  const extract = await fetchWikivoyageExtract(wikivoyageTitle);
  if (!extract) {
    console.warn(`[seed:guides] Skipping "${city}" — no Wikivoyage extract for "${wikivoyageTitle}"`);
    return;
  }

  const chunks = await MDocument.fromText(extract).chunk({
    strategy: 'recursive',
    maxSize: 512,
    overlap: 50,
  });

  const { embeddings } = await embedMany({
    model: ollamaEmbedding,
    values: chunks.map(chunk => chunk.text),
  });

  // Idempotent re-seed: clear this city's existing vectors before inserting
  // the fresh set, so re-running the script doesn't duplicate entries.
  await destinationGuidesVector.deleteVectors({
    indexName: DESTINATION_GUIDES_INDEX,
    filter: { city },
  });

  await destinationGuidesVector.upsert({
    indexName: DESTINATION_GUIDES_INDEX,
    vectors: embeddings,
    metadata: chunks.map(chunk => ({ city, source: 'wikivoyage', text: chunk.text })),
  });

  console.log(`[seed:guides] Seeded "${city}" — ${chunks.length} chunks`);
}

async function main() {
  await destinationGuidesVector.createIndex({
    indexName: DESTINATION_GUIDES_INDEX,
    dimension: DESTINATION_GUIDES_DIMENSION,
  });

  for (const { city, wikivoyageTitle } of CITIES) {
    await seedCity(city, wikivoyageTitle);
  }
}

main()
  .then(() => {
    console.log('[seed:guides] Done.');
    process.exit(0);
  })
  .catch(error => {
    console.error('[seed:guides] Failed:', error);
    process.exit(1);
  });
