import { useNavigate } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type DemoSearchResultItem = {
  id: string;
  title: string;
  url: string;
  description?: string;
  group?: string;
  concept?: string;
};

type DemoSearchResultsCardProps = {
  status: "inProgress" | "executing" | "complete";
  query?: string;
  results: DemoSearchResultItem[];
};

/**
 * Inline tool-result card for the `search_demos` frontend tool: shows the
 * matching demos as a clickable list. Clicking a row navigates to that demo.
 */
export function DemoSearchResultsCard({
  status,
  query,
  results,
}: DemoSearchResultsCardProps) {
  const navigate = useNavigate();

  if (status !== "complete") {
    return (
      <Card className="mt-3 w-full max-w-md">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Searching demos{query ? ` for "${query}"` : ""}...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (results.length === 0) {
    return (
      <Card className="mt-3 w-full max-w-md">
        <CardHeader>
          <CardTitle>No demos matched</CardTitle>
          <CardDescription>
            {query ? `Nothing found for "${query}"` : "No results"}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="mt-3 w-full max-w-md">
      <CardHeader>
        <CardTitle>{query ? `Demos matching "${query}"` : "Demos"}</CardTitle>
        <CardDescription>
          {results.length} result{results.length === 1 ? "" : "s"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => navigate(item.url)}
                className="hover:bg-muted flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{item.title}</span>
                  {item.group ? (
                    <Badge variant="secondary">{item.group}</Badge>
                  ) : null}
                  {item.concept ? (
                    <Badge variant="outline">{item.concept}</Badge>
                  ) : null}
                </div>
                {item.description ? (
                  <span className="text-muted-foreground line-clamp-2 text-xs">
                    {item.description}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
