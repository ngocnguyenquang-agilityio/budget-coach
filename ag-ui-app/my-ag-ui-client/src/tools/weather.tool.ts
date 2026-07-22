import { createTool } from "@mastra/core/tools"
import { z } from "zod"

interface GeocodingResponse {
  results: {
    latitude: number
    longitude: number
    name: string
  }[]
}

interface WeatherResponse {
  current: {
    time: string
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_gusts_10m: number
    weather_code: number
  }
}

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    feelsLike: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    windGust: z.number(),
    conditions: z.string(),
    location: z.string(),
  }),
  execute: async (inputData) => {
    return await getWeather(inputData.location)
  },
})

/**
 * AG-UI tool declaration for the client-side "weather" tool. Passed into
 * `runAgent({ tools: [...] }, ...)` so the model asks the CLI to fetch
 * weather (subject to human-in-the-loop confirmation, see
 * src/tools/confirmation.ts) instead of the agent fetching it in-process.
 */
export const weatherClientTool = {
  name: "weather",
  description: "Get current weather for a location.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "City name",
      },
    },
    required: ["location"],
  },
}

/**
 * Fetches weather for a location and returns it as a JSON string, matching
 * the shape `formatWeatherResult` (src/ui/weatherCard.ts) expects. Never
 * throws -- failures are reported via the returned result so they can be
 * relayed back to the model as a tool result, mirroring the non-throwing
 * contract of `launchUrl`/`evaluateExpression`.
 */
export async function runWeatherTool(
  location: string
): Promise<{ ok: boolean; content: string }> {
  try {
    const result = await getWeather(location)
    return { ok: true, content: JSON.stringify(result) }
  } catch (error) {
    return {
      ok: false,
      content: `Error fetching weather: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

const getWeather = async (location: string) => {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    location
  )}&count=1`
  const geocodingResponse = await fetch(geocodingUrl)
  const geocodingData = (await geocodingResponse.json()) as GeocodingResponse

  if (!geocodingData.results?.[0]) {
    throw new Error(`Location '${location}' not found`)
  }

  const { latitude, longitude, name } = geocodingData.results[0]

  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,weather_code`

  const response = await fetch(weatherUrl)
  const data = (await response.json()) as WeatherResponse

  return {
    temperature: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    windGust: data.current.wind_gusts_10m,
    conditions: getWeatherCondition(data.current.weather_code),
    location: name,
  }
}

function getWeatherCondition(code: number): string {
  const conditions: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    56: "Light freezing drizzle",
    57: "Dense freezing drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Light freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow fall",
    73: "Moderate snow fall",
    75: "Heavy snow fall",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
  }
  return conditions[code] || "Unknown"
}