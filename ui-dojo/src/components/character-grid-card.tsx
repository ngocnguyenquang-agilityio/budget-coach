import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Character = {
  name: string;
  gender?: string;
  age?: number;
  eye_color?: string;
  films?: { title: string }[];
};

export type CharacterGridCardProps = {
  characters: unknown;
};

export const CharacterGridCard = ({ characters }: CharacterGridCardProps) => {
  const parsed = normalizeCharacters(characters);

  if (parsed.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid w-full grid-cols-2 gap-3 sm:grid-cols-3">
      {parsed.map((character) => (
        <Card key={character.name}>
          <CardHeader className="p-3 pb-0">
            <CardTitle className="text-sm">{character.name}</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <div className="grid grid-cols-3 gap-1 text-center text-xs text-muted-foreground">
              <div>
                <div className="font-medium text-foreground">
                  {character.gender ?? "—"}
                </div>
                Gender
              </div>
              <div>
                <div className="font-medium text-foreground">
                  {character.age ?? "—"}
                </div>
                Age
              </div>
              <div>
                <div className="font-medium text-foreground">
                  {character.eye_color ?? "—"}
                </div>
                Eyes
              </div>
            </div>
            {character.films && character.films.length > 0 && (
              <p className="mt-2 truncate text-xs text-muted-foreground">
                {character.films.map((film) => film.title).join(", ")}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

function normalizeCharacters(value: unknown): Character[] {
  const data = typeof value === "string" ? safeParse(value) : value;

  const raw = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { characters?: unknown }).characters)
      ? (data as { characters: unknown[] }).characters
      : [];

  const seen = new Set<string>();
  const characters: Character[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { name, films } = item as Character;
    if (typeof name !== "string" || name.trim() === "" || seen.has(name)) {
      continue;
    }
    seen.add(name);
    // Ensure films is a valid array (or undefined)
    const normalized: Character = {
      ...(item as Character),
      films: Array.isArray(films) ? films : undefined,
    };
    characters.push(normalized);
  }
  return characters;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}
