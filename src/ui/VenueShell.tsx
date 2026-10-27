import type { ReactNode } from "react";
import { Store } from "lucide-react";
import { progressLinks, type VenueProgress, type StepKey } from "@/src/progress/progress";
import { NIGHT_LABEL, VENUE_TYPE_LABEL, type NIGHTS, type VENUE_TYPES } from "@/src/runs/schema";
import { RememberVenue } from "./RememberVenue";
import { Stepper } from "./Stepper";

// The frame every venue page sits in: on a desktop a left rail with the venue and the five steps, on a phone a compact step row on top.
export function VenueShell({ progress, current, children }: { progress: VenueProgress; current: StepKey; children: ReactNode }) {
  const steps = progressLinks(progress, current);
  const type = VENUE_TYPE_LABEL[progress.venueType as (typeof VENUE_TYPES)[number]] ?? progress.venueType;
  const night = NIGHT_LABEL[progress.slowNight as (typeof NIGHTS)[number]] ?? progress.slowNight;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
      {!progress.isDemo && <RememberVenue venueName={progress.venueName} venueType={progress.venueType} slowNight={progress.slowNight} runId={progress.runId} clubId={progress.clubId} clubTitle={progress.clubTitle} />}
      <aside className="no-print lg:sticky lg:top-6 lg:self-start">
        <div className="hidden rounded-lg border-2 border-ink bg-card p-4 shadow-hard lg:block">
          <p className="flex items-center gap-2 text-sm font-bold text-ink-soft">
            <Store aria-hidden="true" size={16} /> Your venue
          </p>
          <p className="mt-1 font-display text-xl font-bold leading-tight">{progress.venueName}</p>
          <p className="text-sm text-ink-soft">
            {type}, slow on {night}s
          </p>
          {progress.isDemo && <p className="mt-2 text-sm font-bold text-ember-ink">Fictional sample venue</p>}
          {progress.clubTitle && <p className="mt-3 border-t-2 border-rule pt-3 text-sm">Club: <span className="font-bold">{progress.clubTitle}</span></p>}
        </div>
        <div className="lg:mt-5">
          <Stepper steps={steps} variant="row" />
          <Stepper steps={steps} variant="list" />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
