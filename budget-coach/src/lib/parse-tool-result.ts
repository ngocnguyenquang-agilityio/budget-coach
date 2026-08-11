// Tool `result` in useRenderTool arrives as a JSON string — parse
// defensively (a weak local model's tool output isn't guaranteed
// well-formed) and fall back to a caller-supplied default on failure.
export const parseToolResult = <T>(
  result: string | undefined,
  fallback: T,
): T => {
  if (!result) return fallback;
  try {
    return JSON.parse(result) as T;
  } catch {
    return fallback;
  }
};
