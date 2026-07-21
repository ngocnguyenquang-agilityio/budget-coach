import { Film as FilmIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type Film = {
  title: string;
  release_date?: string;
  movie_banner?: string;
};

export type WatchlistCardProps = {
  films: Film[];
  onRemove?: (title: string) => void;
};

export const WatchlistCard = ({ films, onRemove }: WatchlistCardProps) => {
  const parsed = normalizeFilms(films);

  return (
    <Card className="mt-3 w-full max-w-md">
      <CardHeader>
        <CardTitle>Your Watchlist ({parsed.length})</CardTitle>
      </CardHeader>
      <CardContent>
        {parsed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Your watchlist is empty. Ask me to add a film!
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {parsed.map((film) => (
              <li
                key={film.title}
                className="flex items-center gap-3 rounded-lg border p-2"
              >
                {film.movie_banner ? (
                  <img
                    src={film.movie_banner}
                    alt={film.title}
                    className="h-16 w-11 shrink-0 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-md bg-muted">
                    <FilmIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{film.title}</div>
                  {film.release_date && (
                    <div className="text-xs text-muted-foreground">
                      {film.release_date}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRemove?.(film.title)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};

function normalizeFilms(value: unknown): Film[] {
  const data = typeof value === "string" ? safeParse(value) : value;

  const raw = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { films?: unknown }).films)
      ? (data as { films: unknown[] }).films
      : [];

  // Keep only well-formed films and dedupe by title so the list keys
  // (key={film.title}) stay defined and unique even if the model repeats or
  // omits a title.
  const seen = new Set<string>();
  const films: Film[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { title } = item as Film;
    if (typeof title !== "string" || title.trim() === "" || seen.has(title)) {
      continue;
    }
    seen.add(title);
    films.push(item as Film);
  }
  return films;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
