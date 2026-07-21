import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const filmSchema = z.object({
  title: z.string(),
  release_date: z.string().optional(),
  movie_banner: z.string().optional().describe("Poster/banner image URL"),
});

export const showWatchlistTool = createTool({
  id: "show_watchlist",
  description:
    "Render the user's current Ghibli watchlist as cards. Pass the COMPLETE current list.",
  inputSchema: z.object({
    films: z.array(filmSchema),
  }),
  outputSchema: z.object({
    films: z.array(filmSchema),
  }),
  execute: async (args) => args as never, // echo — matches the repo's show_calculator pattern
});
