"use client";

import { Button } from "@/components/ui/button";

const AppError = ({ reset }: { error: Error & { digest?: string }; reset: () => void }) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--background)] p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          An unexpected error occurred. Try reloading the page.
        </p>
      </div>
      <Button onClick={reset}>Reload</Button>
    </div>
  );
};

export default AppError;
