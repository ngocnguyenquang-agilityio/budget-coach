import { Film as FilmIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export type Film = {
  title: string;
  description?: string;
  movie_banner?: string;
  release_date?: string;
};

export type FilmGridCardProps = {
  films: unknown;
  onAdd?: (title: string) => void;
  disabled?: boolean;
};

export const FilmGridCard = ({
  films,
  onAdd,
  disabled = false,
}: FilmGridCardProps) => {
  const parsed = normalizeFilms(films);

  if (parsed.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {parsed.map((film) => (
        <Card key={film.title} className="flex flex-col">
          <CardHeader className="p-3 pb-0">
            {film.movie_banner ? (
              <img
                src={film.movie_banner}
                alt={film.title}
                className="h-40 w-full rounded-md object-cover"
              />
            ) : (
              <div className="flex h-40 w-full items-center justify-center rounded-md bg-muted">
                <FilmIcon className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <CardTitle className="mt-2 text-sm">{film.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-2 p-3 pt-2">
            <div>
              {film.release_date && (
                <div className="text-xs text-muted-foreground">
                  {film.release_date}
                </div>
              )}
              {film.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {film.description}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onAdd?.(film.title)}
            >
              Add to watchlist
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
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
