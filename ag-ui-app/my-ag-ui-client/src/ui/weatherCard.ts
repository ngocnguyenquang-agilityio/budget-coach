interface WeatherResult {
  temperature: number
  feelsLike: number
  humidity: number
  windSpeed: number
  windGust: number
  conditions: string
  location: string
}

function isWeatherResult(value: unknown): value is WeatherResult {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.temperature === "number" &&
    typeof v.feelsLike === "number" &&
    typeof v.humidity === "number" &&
    typeof v.windSpeed === "number" &&
    typeof v.windGust === "number" &&
    typeof v.conditions === "string" &&
    typeof v.location === "string"
  )
}

function weatherEmoji(conditions: string): string {
  const c = conditions.toLowerCase()
  if (c.includes("thunder")) return "⛈️"
  if (c.includes("snow")) return "🌨️"
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️"
  if (c.includes("fog")) return "🌫️"
  if (c.includes("overcast") || c.includes("cloud")) return "☁️"
  if (c.includes("clear")) return "☀️"
  return "🌤️"
}

/**
 * Parses a tool-call result and, if it matches the weatherTool output shape,
 * renders it as a formatted card. Returns null for any other tool's output
 * so callers can fall back to generic rendering.
 */
export function formatWeatherResult(content: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  if (!isWeatherResult(parsed)) return null

  const { location, conditions, temperature, feelsLike, humidity, windSpeed, windGust } = parsed
  const emoji = weatherEmoji(conditions)
  const title = `${emoji}  Weather in ${location}`
  const rule = "─".repeat(title.length)

  const lines = [
    title,
    rule,
    `Conditions   ${conditions}`,
    `Temperature  ${temperature}°C (feels like ${feelsLike}°C)`,
    `Humidity     ${humidity}%`,
    `Wind         ${windSpeed} km/h (gusts ${windGust} km/h)`,
  ]

  return lines.join("\n")
}

/** Human-readable one-liner, e.g. for the session dashboard. */
export function formatWeatherSummary(content: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!isWeatherResult(parsed)) return null
  return `${parsed.location}: ${parsed.temperature}°C, ${parsed.conditions}`
}

const WEATHER_TOOL_NAMES = new Set(["weatherTool", "get-weather", "get_weather"])

export function isWeatherToolName(toolCallName: string): boolean {
  return WEATHER_TOOL_NAMES.has(toolCallName)
}
