"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { Card } from "./Card";
import { Spinner } from "./Spinner";

// Shown when a club has no kit yet: asks the server to write it, then reloads the page with the finished kit.
export function KitLoader({ clubId, title }: { clubId: string; title: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  const write = useCallback(async () => {
    setProblem(null);
    try {
      const response = await fetch(`/api/clubs/${clubId}/kit`, { method: "POST" });
      if (response.ok) {
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setProblem(body.error ?? "Something went wrong while writing the kit.");
    } catch {
      setProblem("We could not reach the server. Check your connection and try again.");
    }
  }, [clubId, router]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void write();
  }, [write]);

  return (
    <Card className="flex max-w-xl flex-col items-start gap-4 shadow-hard">
      <h1 className="text-[2rem]">{title}</h1>
      {problem ? (
        <>
          <p role="alert" className="font-bold">
            {problem}
          </p>
          <Button
            onClick={() => {
              void write();
            }}
          >
            Try again
          </Button>
        </>
      ) : (
        <>
          <Spinner label="Writing your kit: poster, run of show, listing, playlist and menu special." />
          <p className="text-sm text-ink-soft">This takes about 15 seconds. Nothing to do but wait.</p>
        </>
      )}
    </Card>
  );
}
