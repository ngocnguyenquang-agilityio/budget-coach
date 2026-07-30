import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { weatherTool } from '../tools/weather-tool';
import { setTemperatureUnitTool } from '../tools/set-temperature-unit-tool';

const ollama = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
});

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: `You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather.

Your primary function is to help users get weather details for specific locations. When responding:
- Always ask for a location if none is provided
- If the location name isn't in English, please translate it
- If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
- Include relevant details like humidity, wind conditions, and precipitation
- Keep responses concise but informative
- If the user asks for activities and provides the weather forecast, suggest activities based on the weather forecast.
- If the user asks for activities, respond in the format they request.

Use the weatherTool to fetch current weather data. weatherTool always returns temperature and feelsLike in Celsius.

You have a "Temperature Unit" preference available in your working memory (Preferences section). If the user asks to use Fahrenheit (or Celsius), call setTemperatureUnitTool with that unit to save it. When reporting weather, check your working memory's Temperature Unit: if it is set to fahrenheit, convert weatherTool's Celsius values to Fahrenheit (F = C * 9/5 + 32) before presenting them and label them °F; otherwise present the Celsius values as-is and label them °C.`,
  model: ollama('llama3.1'),
  tools: { weatherTool, setTemperatureUnitTool },
  memory: new Memory({
    options: {
      workingMemory: {
        enabled: true,
        template: `# Preferences\n- Temperature Unit: [celsius | fahrenheit]`,
      },
    },
  }),
});
