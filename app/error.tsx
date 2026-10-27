"use client";

import { Button } from "@/src/ui/Button";
import { EmptyState } from "@/src/ui/EmptyState";

// Any page that fails to load lands here. The reason stays in the server log; the person gets plain words and a way on.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-8">
      <EmptyState
        title="Something went wrong on our side"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={reset}>Try again</Button>
            <Button href="/" variant="secondary">
              Go to the start
            </Button>
          </div>
        }
      >
        The page could not load. Nothing you entered was lost. Try again, and if it keeps happening, start from the first page.
      </EmptyState>
    </div>
  );
}
