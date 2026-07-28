import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { z } from "zod";
import { ghibliFilms, ghibliCharacters } from "../tools/ghibli-tool";
import { showWatchlistTool } from "../tools/watchlist-tool";
import { getStorage } from "../storage";

export const ghibliAgent = new Agent({
  id: "ghibli-agent",
  name: "Ghibli Agent",
  description:
    "This agent answers questions about Studio Ghibli films and characters, and manages a personal watchlist.",
  instructions: `You are my Ghibli Films assistant. I will ask you questions and you must use the two tools ghibliFilms and ghibliCharacters to answer my questions. Always use the tools to get information about Studio Ghibli films and characters. If you don't know the answer, say 'I don't know'.

You also manage my personal Ghibli watchlist, stored in working memory under 'watchlist'. Treat the working-memory watchlist as the source of truth at all times.

- ADD: when I ask to add a film, first call ghibliFilms to resolve its release_date and movie_banner. Then use the updateWorkingMemory tool to append it to the watchlist (do NOT add a duplicate title — if it's already there, leave the list unchanged). Finally call show_watchlist with the FULL updated list.
- REMOVE: when I ask to remove a film, use updateWorkingMemory to remove it from the watchlist, then call show_watchlist with the full remaining list (pass films: [] if the list is now empty).
- SHOW: when I ask to see my watchlist, call show_watchlist with the current working-memory list (films: [] if empty).

After calling show_watchlist, add only a brief one-line remark — do NOT repeat the film list as text, the UI renders it as cards.

After calling ghibliFilms or ghibliCharacters, add only a brief one-line remark — do NOT repeat the film/character list as text, the UI renders it as cards.`,
  model: "google/gemini-3.5-flash",
  tools: {
    ghibliFilms,
    ghibliCharacters,
    show_watchlist: showWatchlistTool,
  },
  defaultOptions: {
    maxSteps: 20,
    providerOptions: {
      google: {
        thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
      },
    },
  },
  memory: new Memory({
    storage: getStorage(),
    options: {
      workingMemory: {
        enabled: true,
        scope: "thread",
        schema: z.object({
          watchlist: z
            .array(
              z.object({
                title: z.string(),
                release_date: z.string().optional(),
                movie_banner: z.string().optional(),
              }),
            )
            .describe("The user's saved Ghibli films"),
        }),
      },
    },
  }),
});
