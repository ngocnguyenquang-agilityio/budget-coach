import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const ollama = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});
