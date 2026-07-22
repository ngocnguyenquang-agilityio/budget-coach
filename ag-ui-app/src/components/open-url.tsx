import { useState } from "react";

export interface OpenUrlCardProps {
  url?: string;
  status: "inProgress" | "executing" | "complete";
  respond?: (response: string) => void;
  /** Fired after the URL is actually opened, so the caller can record it in shared state. */
  onOpened?: (url: string) => void;
}

/**
 * Browser equivalent of the CLI's y/N openUrl confirmation: a browser page
 * can't shell out to the OS default browser, so approval opens the link in
 * a new tab instead.
 */
export function OpenUrlCard({ url, status, respond, onOpened }: OpenUrlCardProps) {
  const [decision, setDecision] = useState<"opened" | "declined" | null>(null);

  const handleOpen = () => {
    if (!url) return;
    setDecision("opened");
    window.open(url, "_blank", "noopener,noreferrer");
    onOpened?.(url);
    respond?.(`Opened ${url} in a new tab.`);
  };

  const handleDecline = () => {
    setDecision("declined");
    respond?.("User declined to open the URL.");
  };

  return (
    <div className="rounded-2xl shadow-xl max-w-md w-full mt-6 bg-neutral-900">
      <div className="bg-white/10 backdrop-blur-md p-6 w-full rounded-2xl">
        {decision === "opened" ? (
          <p className="text-white/90 text-center">
            Opened <span className="font-mono">{url}</span> in a new tab.
          </p>
        ) : decision === "declined" ? (
          <p className="text-white/90 text-center">Declined to open the link.</p>
        ) : (
          <>
            <p className="text-white mb-4 text-center break-all">
              Open <span className="font-mono">{url}</span>?
            </p>
            {status === "executing" && (
              <div className="flex gap-3">
                <button
                  onClick={handleOpen}
                  className="flex-1 px-6 py-3 rounded-xl bg-white text-black font-bold
                    shadow-lg hover:shadow-xl transition-all
                    hover:scale-105 active:scale-95"
                >
                  Open
                </button>
                <button
                  onClick={handleDecline}
                  className="flex-1 px-6 py-3 rounded-xl bg-black/20 text-white font-bold
                    border-2 border-white/30 shadow-lg
                    transition-all hover:scale-105 active:scale-95
                    hover:bg-black/30"
                >
                  Decline
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
