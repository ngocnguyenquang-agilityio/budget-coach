// Shared redaction for the Coach leaking its read-only working memory into a
// reply. Used by two layers that see the text at different points:
//   1. WorkingMemoryLeakGuardrail (processOutputResult) — post-generation
//      backstop that rewrites the stored message.
//   2. The AG-UI run wrapper (src/agent.ts) — the choke point that actually
//      controls what the browser renders. With `useProcessedFinalText` the
//      Coach's whole reply arrives as a single TEXT_MESSAGE_CHUNK, so
//      redacting that chunk's delta is the only thing the user reliably sees
//      (a processOutputResult mutation does not make it into the finish
//      chunk's uiMessages that @ag-ui/mastra re-emits).
//
// gpt-oss-120b on Cerebras, having seen Mastra's working-memory prompts in
// training, pattern-matches the injected `<working_memory_data>` block and
// reflexively reproduces the *update ritual* it learned — planning a call to a
// (nonexistent, agentManaged:false) updateWorkingMemory tool and dumping the
// working-memory JSON, sometimes more than once, before the real answer.

const MIN_MARKER_MATCHES = 3;

// Brace-matches from `start` (a `{`), string/escape aware so a `}` inside a
// quoted value (pot name, nickname, ...) doesn't end the object early.
// Returns the index of the matching `}`, or -1 if the text ends unbalanced.
const matchBrace = (text: string, start: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

// Whole lines that are pure working-memory-update ritual — never legitimate
// assistant output. `updateWorkingMemory` is a tool the user's Coach does not
// even have (agentManaged:false); "Do not remove empty sections" is verbatim
// Mastra tool-instruction boilerplate the model hallucinates.
const RITUAL_LINE_MARKERS = [/updateWorkingMemory/i, /Do not remove empty sections/i];

export interface RedactionResult {
  text: string;
  redactedLength: number;
}

// Removes EVERY top-level `{...}` span carrying at least MIN_MARKER_MATCHES
// working-memory field names (not just the first — a single reply can paste
// the blob twice), then drops any ritual lines, then tidies whitespace.
export const redactWorkingMemoryLeak = (
  text: string,
  markers: readonly string[],
): RedactionResult => {
  let result = text;
  let redactedLength = 0;

  for (let i = 0; i < result.length; i++) {
    if (result[i] !== "{") continue;
    const end = matchBrace(result, i);
    if (end === -1) continue;
    const candidate = result.slice(i, end + 1);
    const matches = markers.filter((marker) => candidate.includes(marker)).length;
    if (matches < MIN_MARKER_MATCHES) continue;
    redactedLength += end + 1 - i;
    result = `${result.slice(0, i)}${result.slice(end + 1)}`;
    i -= 1; // rescan from the seam so an adjacent second blob is caught too
  }

  const beforeLines = result.length;
  result = result
    .split(/\r?\n/)
    .filter((line) => !RITUAL_LINE_MARKERS.some((marker) => marker.test(line)))
    .join("\n");
  redactedLength += beforeLines - result.length;

  if (redactedLength === 0) return { text, redactedLength: 0 };

  result = result.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text: result, redactedLength };
};
