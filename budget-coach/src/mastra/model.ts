import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1",
});

export const model =
  process.env.MODEL_PROVIDER === "google"
    ? "google/gemini-3.6-flash"
    : ollama(process.env.OLLAMA_MODEL ?? "llama3.1");
