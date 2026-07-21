import { formatFileSize, getDocumentIcon } from "@copilotkit/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AttachedFileCardProps = {
  filename?: string;
  mimeType?: string;
  size?: number;
  characters?: number;
  text?: string;
  /** Set when extraction failed instead of succeeding. */
  errorMessage?: string;
  status: "inProgress" | "executing" | "complete";
};

/**
 * Inline tool-result card for the `show_attached_file` frontend tool: shows
 * the attached file's type/name/size and a scrollable preview of the text
 * extracted from it in the browser.
 */
export function AttachedFileCard({
  filename,
  mimeType,
  size,
  characters,
  text,
  errorMessage,
  status,
}: AttachedFileCardProps) {
  if (status !== "complete") {
    return (
      <Card className="mt-3 w-full max-w-md">
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Reading{filename ? ` ${filename}` : " attached file"}...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (errorMessage) {
    return (
      <Card className="mt-3 w-full max-w-md border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">
            Couldn't read {filename ?? "the file"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-3 w-full max-w-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-mono">
            {getDocumentIcon(mimeType ?? "")}
          </Badge>
          <CardTitle className="truncate">{filename ?? "Attached file"}</CardTitle>
        </div>
        <CardDescription>
          {typeof size === "number" ? formatFileSize(size) : null}
          {typeof size === "number" && typeof characters === "number"
            ? " · "
            : null}
          {typeof characters === "number"
            ? `${characters.toLocaleString()} characters`
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre
          className={cn(
            "max-h-64 overflow-y-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap",
          )}
        >
          {text || "No text extracted."}
        </pre>
      </CardContent>
    </Card>
  );
}
