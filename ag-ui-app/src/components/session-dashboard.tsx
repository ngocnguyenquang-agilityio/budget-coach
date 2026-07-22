import type { AgUiAssistantState } from "@/lib/agUiAssistantState";

/** Web equivalent of the CLI's renderDashboard() console output. */
export function SessionDashboard({ state }: { state: AgUiAssistantState }) {
  const lastWeather = state.weatherLookups.at(-1);
  const lastCalc = state.calculations.at(-1);

  return (
    <div className="rounded-2xl shadow-xl max-w-md w-full mt-6 bg-neutral-900/80 backdrop-blur-md">
      <div className="p-6 text-white/90 text-sm space-y-2">
        <h3 className="text-white font-bold mb-2">Session state</h3>
        <p>
          Last weather:{" "}
          {lastWeather ? `${lastWeather.location} — ${lastWeather.summary}` : "—"}
        </p>
        <p>
          Last calculation:{" "}
          {lastCalc ? `${lastCalc.expression} = ${lastCalc.result}` : "—"}
        </p>
        <p>Opened URLs: {state.openedUrls.length}</p>
        <p className="text-white/50 text-xs">
          Last updated: {state.lastUpdated ?? "—"}
        </p>
      </div>
    </div>
  );
}
