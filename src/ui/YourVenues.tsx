"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { forgetRemembered, readRemembered, type RememberedVenue } from "@/src/progress/remember";
import { NIGHT_LABEL, VENUE_TYPE_LABEL } from "@/src/runs/schema";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";

// Furthest page this venue has reached: the club's weekly report, else the club kit, else the run.
function continueHref(v: RememberedVenue): { href: string; label: string } {
  if (v.clubId) return { href: `/clubs/${v.clubId}`, label: "Open your club" };
  if (v.runId) return { href: `/runs/${v.runId}/clubs`, label: "Pick your club" };
  return { href: "/", label: "Start again" };
}

export function YourVenues() {
  const [venues, setVenues] = useState<RememberedVenue[] | null>(null);
  useEffect(() => {
    // Read after mount: localStorage does not exist on the server.
    const timer = setTimeout(() => setVenues(readRemembered()), 0);
    return () => clearTimeout(timer);
  }, []);

  if (venues === null) return <p className="text-ink-soft" role="status">Looking for your venues...</p>;
  if (venues.length === 0) {
    return (
      <EmptyState
        title="No venues yet"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button href="/#start" variant="cta">Start with your venue</Button>
            <Button href="/sample" variant="secondary">Explore a sample venue</Button>
          </div>
        }
      >
        When you read a neighbourhood, your venue is saved here, in this browser. There is no login.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {venues.map((v) => {
        const next = continueHref(v);
        return (
          <li key={v.key} className="relative flex flex-col gap-2 rounded-lg border-2 border-ink bg-card p-5 shadow-hard transition-transform duration-200 hover:-translate-y-1 hover:-rotate-1">
            <h2 className="pr-8 text-2xl">{v.venueName}</h2>
            <p className="text-sm text-ink-soft">
              {VENUE_TYPE_LABEL[v.venueType as keyof typeof VENUE_TYPE_LABEL] ?? v.venueType}, slow on {NIGHT_LABEL[v.slowNight as keyof typeof NIGHT_LABEL] ?? v.slowNight}s
            </p>
            <p className="text-sm">{v.clubTitle ? <>Club: <span className="font-bold">{v.clubTitle}</span></> : "No club picked yet"}</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Button href={next.href} variant="cta">
                {next.label} <ArrowRight aria-hidden="true" size={18} />
              </Button>
              {v.clubId && (
                <Link href={`/clubs/${v.clubId}/weeks`} className="inline-flex min-h-12 items-center font-bold">
                  Weekly report
                </Link>
              )}
            </div>
            <button
              type="button"
              aria-label={`Remove ${v.venueName} from this list`}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-peach"
              onClick={() => {
                forgetRemembered(v.key);
                setVenues(readRemembered());
              }}
            >
              <X aria-hidden="true" size={18} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
