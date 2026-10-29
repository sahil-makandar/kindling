import type { VenueInput } from "../locator";
import type { Llm } from "../llm";
import type { StageFn } from "../runStage";
import type { PoolSignal } from "../scout/pool";
import { BASELINE_SYSTEM, baselinePrompt, baselineSchema, baselineVerdict, type BaselineVerdict } from "./baseline";

export type BaselineDeps = {
  getVenue(venueId: string): Promise<(VenueInput & { slowNight?: string | null }) | null>;
  loadPool(runId: string): Promise<PoolSignal[]>;
  saveBaseline(runId: string, baseline: { ideas: string[]; verdict: BaselineVerdict }): Promise<void>;
  generateStructured: Llm["generateStructured"];
};

// Mock mode only (tests and keyless development): canned ideas so the rest of the page can be exercised.
const MOCK_IDEAS = ["Weekly open mic night", "Trivia night with prizes", "Live acoustic music evening"];

// The "Without Qloo" panel: a real model call with no Qloo data. If no model answers, nothing is saved, because a
// hand-written comparison would be a strawman.
export function createBaselineStage(deps: BaselineDeps): StageFn {
  return async ({ run, trace }) => {
    const venue = await deps.getVenue(run.venueId);
    if (!venue) throw new Error(`Venue ${run.venueId} not found`);

    const result = await deps.generateStructured(
      baselineSchema,
      baselinePrompt({ venueType: venue.venueType, address: venue.address, night: venue.slowNight ?? null }),
      {
        runId: run.id,
        cacheKey: "baseline",
        tier: "fast",
        system: BASELINE_SYSTEM,
        trace,
        maxOutputTokens: 500,
        fallback: () => ({ ideas: [] as unknown as [string, string, string] }),
        mock: () => ({ ideas: MOCK_IDEAS }),
      },
    );

    if (result.source === "fallback") {
      await trace.warn("The comparison without Qloo needs a language model and none answered, so it is skipped.");
      return;
    }

    const verdict = baselineVerdict(result.output.ideas, await deps.loadPool(run.id));
    await deps.saveBaseline(run.id, { ideas: result.output.ideas, verdict });
    await trace.info(`For comparison, a language model with no Qloo data suggested: ${result.output.ideas.join("; ")}. ${verdict.sentence}`, {
      verdict,
    });
  };
}
