import { Button } from "@/src/ui/Button";
import { EmptyState } from "@/src/ui/EmptyState";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-8">
      <EmptyState
        title="We could not find that page"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button href="/">Go to the start</Button>
            <Button href="/demo" variant="secondary">
              See a demo venue
            </Button>
          </div>
        }
      >
        The link may be old or mistyped. Runs and clubs are found by the link they were given when they were made.
      </EmptyState>
    </div>
  );
}
