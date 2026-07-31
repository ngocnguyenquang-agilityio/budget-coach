import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { weatherAgent } from '../agents/weather-agent';

export const askWeatherAgentTool = createTool({
  id: 'ask-weather-agent',
  description:
    'Ask the weather agent for a short description of current weather conditions in a city. Use this to ground a trip itinerary in real conditions.',
  inputSchema: z.object({
    city: z.string().describe('The city to get current weather conditions for'),
  }),
  outputSchema: z.object({
    weather: z.string(),
  }),
  execute: async (inputData) => {
    const { city } = inputData;

    try {
      const response = await weatherAgent.stream([
        {
          role: 'user',
          content: `What's the current weather in ${city}? Give me the conditions, temperature, and precipitation chance in a couple of sentences.`,
        },
      ]);

      let weather = '';
      for await (const chunk of response.textStream) {
        weather += chunk;
      }

      return { weather };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { weather: `Could not get weather for ${city}: ${message}` };
    }
  },
});
