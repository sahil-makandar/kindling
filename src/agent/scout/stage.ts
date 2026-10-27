import { UserFacingError } from "@/src/lib/errors";
import { cityFromAddress, type VenueInput } from "../locator";
import type { Llm } from "../llm";
import { scoutBriefing, scoutSystemPrompt } from "../prompts/scout";
import type { StageFn } from "../runStage";
import { DOMAIN_LABEL, type ScoutDomain } from "./plan";
import type { PoolSignal } from "./pool";
import { MAX_QLOO_CALLS, runDeterministicPlan, ScoutRun, type ScoutApi, type ScoutVenue } from "./scout";
import { buildScoutTools } from "./tools";

export const MAX_SCOUT_STEPS = 8;
// The model gets 25 s, so the standard plan still has time to finish inside the 60 s route limit.
const SCOUT_MODEL_BUDGET_MS = 25_000;
// After this long the Scout stops starting new scans and finishes with what it has.
const SCOUT_TOTAL_MS = 50_000;
const MIN_DOMAINS = 3;

export type ScoutDeps = {
  getVenue(venueId: string): Promise<VenueInput | null>;
  saveSignals(runId: string, signals: PoolSignal[]): Promise<void>;
  saveRadius(runId: string, radiusM: number | null): Promise<void>;
  api: ScoutApi;
  runToolLoop: Llm["runToolLoop"];
  maxQlooCalls?: number;
  maxSteps?: number;
  now?: () => number;
};

function toScoutVenue(venue: VenueInput): ScoutVenue {
  const firstPart = cityFromAddress(venue.address).split(",")[0]?.trim();
  return {
    name: venue.name,
    venueType: venue.venueType,
    lat: venue.lat,
    lon: venue.lon,
    city: firstPart ? firstPart : null,
    qlooEntityId: venue.qlooEntityId ?? null,
    tags: venue.qlooTags ?? [],
  };
}

// The Scout: reads what the area, the venue's own crowd and the trends love, and builds the signal pool.
// A model chooses each next Qloo call from what it has found so far; the standard plan covers any failure.
export function createScoutStage(deps: ScoutDeps): StageFn {
  return async ({ run, trace }) => {
    const row = await deps.getVenue(run.venueId);
    if (!row) throw new Error(`Venue ${run.venueId} not found`);

    const maxCalls = deps.maxQlooCalls ?? MAX_QLOO_CALLS;
    const now = deps.now ?? Date.now;
    const scout = new ScoutRun({
      venue: toScoutVenue(row),
      api: deps.api,
      trace,
      runId: run.id,
      maxCalls,
      deadlineAt: now() + SCOUT_TOTAL_MS,
      now,
    });

    await scout.adoptVenueTags();
    await trace.info(
      `Scouting around ${row.name}. I have ${maxCalls} Qloo calls to spend and will pick each one from what I find.`,
    );

    try {
      await deps.runToolLoop(buildScoutTools(scout), scoutSystemPrompt({ budget: maxCalls, venueType: row.venueType }), {
        runId: run.id,
        tier: "fast",
        prompt: scoutBriefing({ venue: scout.venue, radiusSteps: scout.ladderLabels }),
        maxSteps: deps.maxSteps ?? MAX_SCOUT_STEPS,
        budgetMs: SCOUT_MODEL_BUDGET_MS,
        stepMs: 12_000,
        trace,
        fallback: () => runDeterministicPlan(scout),
      });

      // A model that stops early gets topped up by the standard plan, which skips what is already done.
      if (!scout.isEnough() && scout.callsLeft > 0) {
        await trace.info(`Not enough yet (${scout.missing().join("; ")}), so I am finishing with the standard plan.`);
        await runDeterministicPlan(scout);
      }
    } finally {
      // Keep whatever was found, even if something failed part-way.
      await deps.saveSignals(run.id, scout.pool.all());
      await deps.saveRadius(run.id, scout.radiusM);
    }

    if (scout.timeUp) await trace.warn("Time was nearly up, so I stopped scouting with what I had found.");
    const strong = scout.pool.strongDomains() as ScoutDomain[];
    await trace.info(
      `Scouting done: ${scout.callsUsed} Qloo calls, ${strong.length} strong domain${strong.length === 1 ? "" : "s"}` +
        `${strong.length ? ` (${strong.map((d) => DOMAIN_LABEL[d]).join(", ")})` : ""}, ` +
        `${scout.pool.tags().length} area tags, ${scout.pool.entities("place").length} nearby places, read ${scout.radiusLabel}.`,
      { qlooCalls: scout.callsUsed, radiusM: scout.radiusM },
    );

    if (scout.pool.domains().length < MIN_DOMAINS) {
      throw new UserFacingError(
        "Qloo has too little taste data around this address to build clubs. Try a nearby address or a bigger city.",
      );
    }
  };
}
