import { createTool } from "@mastra/core/tools";
import { z } from "zod";

async function fetchJson(id: string) {
  const response = await fetch(id, {
    headers: {
      "Content-Type": "application/json",
    },
  });
  return response.json();
}

export const ghibliFilms = createTool({
  id: "ghibli-films",
  description:
    "Get information about Ghibli films. Pass `title` to look up one specific film; omit it to get the full list.",
  inputSchema: z.object({
    title: z
      .string()
      .optional()
      .describe(
        "Exact or partial film title to filter by (case-insensitive). Omit to return all films.",
      ),
  }),
  execute: async ({ title }) => {
    const films = await fetchJson(`https://ghibliapi.vercel.app/films`);

    const mapped = films.map(
      (film: {
        title: string;
        description: string;
        movie_banner: string;
        release_date: string;
      }) => ({
        title: film.title,
        description: film.description,
        movie_banner: film.movie_banner,
        release_date: film.release_date,
      }),
    );

    if (!title) {
      return mapped;
    }
    const needle = title.toLowerCase();
    return mapped.filter((film: { title: string }) =>
      film.title.toLowerCase().includes(needle),
    );
  },
});

export const ghibliCharacters = createTool({
  id: "ghibli-characters",
  description:
    "Get information about Ghibli characters. Pass `name` to look up one specific character, `film` to list the characters that appear in one specific film, or omit both to get the full list.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe(
        "Exact or partial character name to filter by (case-insensitive). Omit to return all characters.",
      ),
    film: z
      .string()
      .optional()
      .describe(
        "Exact or partial film title to filter characters by (case-insensitive) — returns only characters appearing in that film. Omit to not filter by film.",
      ),
  }),
  execute: async ({ name, film }) => {
    let characters: Array<{
      name: string;
      gender: string;
      age: number;
      eye_color: string;
      films: string[];
    }>;

    if (film) {
      const films = await fetchJson(`https://ghibliapi.vercel.app/films`);
      const needle = film.toLowerCase();
      const matchedFilms = films.filter((f: { title: string }) =>
        f.title.toLowerCase().includes(needle),
      );

      const peopleUrls = new Set<string>(
        matchedFilms.flatMap((f: { people: string[] }) => f.people),
      );

      characters = await Promise.all(
        Array.from(peopleUrls).map((url) => fetchJson(url)),
      );
    } else {
      characters = await fetchJson(`https://ghibliapi.vercel.app/people`);
    }

    const filtered = name
      ? characters.filter((character: { name: string }) =>
          character.name.toLowerCase().includes(name.toLowerCase()),
        )
      : characters;

    return await Promise.all(
      filtered.map(
        async (character: {
          name: string;
          gender: string;
          age: number;
          eye_color: string;
          films: string[];
        }) => ({
          name: character.name,
          gender: character.gender,
          age: character.age,
          eye_color: character.eye_color,
          films: await Promise.all(
            character.films.map(async (filmUrl: string) => {
              const film = await fetchJson(filmUrl);
              return {
                title: film.title,
              };
            }),
          ),
        }),
      ),
    );
  },
});
