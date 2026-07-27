import { SIDEBAR } from "@/components/layout";

/** One demo page from the app's own sidebar catalog, flattened out of its SDK group. */
export type DemoEntry = {
  id: string;
  title: string;
  url: string;
  description: string;
  /** Sub-grouping inside an SDK, e.g. "Workflow" or "Generative UI". */
  concept?: string;
  /** SDK group title, e.g. "CopilotKit". */
  group: string;
};

export type DemoSearchResult = DemoEntry & { score: number };

/** Flattens SIDEBAR into a single list, preserving sidebar order. */
function flattenDemos(): DemoEntry[] {
  return SIDEBAR.flatMap((group) =>
    group.items.map((item) => ({
      id: item.id,
      // The sidebar sometimes abbreviates (e.g. "Obs. Memory"); pageTitle
      // holds the full name when it does.
      title: item.pageTitle ?? item.title,
      url: item.url,
      description: item.description,
      concept: item.concept,
      group: group.title,
    })),
  );
}

/** SIDEBAR is a module-level constant, so flatten once at import time. */
export const DEMOS: DemoEntry[] = flattenDemos();

/** DEMOS re-grouped by SDK, in sidebar order — the shape the palette renders. */
export const DEMO_GROUPS: { group: string; demos: DemoEntry[] }[] = SIDEBAR.map(
  (group) => ({
    group: group.title,
    demos: DEMOS.filter((demo) => demo.group === group.title),
  }),
);

/** Everything a demo can be matched against, as one lowercase haystack string. */
export function demoSearchValue(demo: DemoEntry): string {
  return [demo.title, demo.concept, demo.group, demo.description, demo.id]
    .filter(Boolean)
    .join(" ");
}

/** Per-term field scores: title beats concept beats group beats description. */
function scoreDemo(demo: DemoEntry, terms: string[]): number {
  const title = demo.title.toLowerCase();
  const concept = (demo.concept ?? "").toLowerCase();
  const group = demo.group.toLowerCase();
  const description = demo.description.toLowerCase();

  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (title === term) best = 100;
    else if (title.startsWith(term)) best = 70;
    else if (title.includes(term)) best = 50;
    else if (concept.includes(term)) best = 30;
    else if (group.includes(term)) best = 20;
    else if (description.includes(term)) best = 15;
    // Every term must match somewhere, so "workflow suspend" doesn't return
    // every workflow demo.
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Ranks the demo catalog against a free-text query. Deterministic: ties break
 * by SDK group then title, so the same query always yields the same order.
 */
export function searchDemos(query: string, limit = 5): DemoSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return DEMOS.slice(0, limit).map((demo) => ({ ...demo, score: 0 }));
  }
  return DEMOS.map((demo) => ({ ...demo, score: scoreDemo(demo, terms) }))
    .filter((result) => result.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.group.localeCompare(b.group) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit);
}
