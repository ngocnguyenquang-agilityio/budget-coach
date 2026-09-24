import { SEARCH_FILLER_WORDS } from "@/constants/search-filler-words";

// Splits a name search into the words that must each appear in the
// merchant, e.g. "my new Jacket" → ["jacket"]. If every word is filler, the
// words are kept as-is so the search still filters something.
export const toSearchTerms = (search: string): string[] => {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = words.filter((word) => !SEARCH_FILLER_WORDS.includes(word));
  return meaningful.length > 0 ? meaningful : words;
};
