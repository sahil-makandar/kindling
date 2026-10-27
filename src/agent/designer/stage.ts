import { z } from "zod";
import { UserFacingError } from "@/src/lib/errors";
import { cityFromAddress, type VenueInput } from "../locator";
import type { Llm } from "../llm";
import { DESIGNER_SYSTEM, designerPrompt } from "../prompts/designer";
import type { StageFn } from "../runStage";
import type { PoolSignal } from "../scout/pool";
import {
  buildAliasTable,
  CLUB_FORMATS,
  MAX_CANDIDATES,
  MIN_CANDIDATES,
  resolveCandidates,
  standardCandidates,
  type ClubCandidate,
  type RawCandidate,
} from "./candidates";

// The Designer: proposes 6 to 8 hidden clubs from the Scout's pool. The model cites aliases, the code resolves them
// to real pool signals and drops anything that does not hold up, and the standard plan tops up if too few survive.

export const rawDesignSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        anchor: z.string().min(1),
        companions: z.array(z.string().min(1)).min(1).max(2),
        format: z.enum(CLUB_FORMATS),
        why: z.string().min(8).max(400),
      }),
    )
    .min(3)
    .max(10),
});
type RawDesign = z.infer<typeof rawDesignSchema>;

export type DesignerDeps = {
  getVenue(venueId: string): Promise<(VenueInput & { slowNight?: string | null }) | null>;
  loadPool(runId: string): Promise<PoolSignal[]>;
  saveCandidates(runId: string, candidates: ClubCandidate[]): Promise<void>;
  generateStructured: Llm["generateStructured"];
};

export function createDesignStage(deps: DesignerDeps): StageFn {
  return async ({ run, trace }) => {
    const venue = await deps.getVenue(run.venueId);
    if (!venue) throw new Error(`Venue ${run.venueId} not found`);

    const pool = await deps.loadPool(run.id);
    const { aliases, view } = buildAliasTable(pool);
    if (view.domains.length < 3) {
      throw new UserFacingError("The Scout did not find enough taste signals to design clubs from.");
    }

    const standard = (count: number, used?: ReadonlySet<string>): RawDesign => ({
      candidates: standardCandidates(view, aliases, venue.venueType, count, used) as RawDesign["candidates"],
    });

    const result = await deps.generateStructured(
      rawDesignSchema,
      designerPrompt({
        venueName: venue.name,
        venueType: venue.venueType,
        city: cityFromAddress(venue.address).split(",")[0]?.trim() || null,
        slowNight: venue.slowNight ?? null,
        view,
      }),
      {
        runId: run.id,
        cacheKey: "design",
        tier: "main",
        system: DESIGNER_SYSTEM,
        trace,
        maxOutputTokens: 3000,
        fallback: () => standard(MAX_CANDIDATES),
        mock: () => standard(MAX_CANDIDATES),
        // An answer where almost nothing resolves is sent back once with the reason, before we give up on it.
        check: (value) => {
          const { kept, dropped } = resolveCandidates(value.candidates as RawCandidate[], aliases);
          if (kept.length < 3) {
            throw new Error(
              `Only ${kept.length} of your ${value.candidates.length} clubs were usable (${dropped.map((d) => d.reason).join("; ")}). Use only the ids listed, and companions from different lists than the anchor.`,
            );
          }
        },
      },
    );

    const { kept, dropped } = resolveCandidates(result.output.candidates as RawCandidate[], aliases);
    for (const d of dropped) await trace.warn(`Dropped "${d.title}": ${d.reason}.`);

    const candidates = [...kept];
    if (candidates.length < MIN_CANDIDATES) {
      const used = new Set(candidates.map((c) => c.anchor.id));
      const topUp = resolveCandidates(standard(MIN_CANDIDATES - candidates.length + 2, used).candidates as RawCandidate[], aliases).kept
        .filter((c) => !used.has(c.anchor.id))
        .slice(0, MIN_CANDIDATES - candidates.length);
      if (topUp.length > 0) {
        candidates.push(...topUp);
        await trace.info(`Added ${topUp.length} idea${topUp.length === 1 ? "" : "s"} from the standard plan so there are enough to compare.`);
      }
    }

    await deps.saveCandidates(run.id, candidates);
    await trace.info(
      `Designed ${candidates.length} hidden clubs: ${candidates.map((c) => c.title).join(", ")}.`,
      { source: result.source, titles: candidates.map((c) => c.title) },
    );
  };
}
