import { getDb, type Db } from "@/src/db/client";
import { baselines } from "@/src/db/schema";
import { createDbDesignerRepo } from "../designer/repo";
import { generateStructured } from "../llm";
import type { StageFn } from "../runStage";
import { createDbVenueRepo } from "../venueRepo";
import { createBaselineStage, type BaselineDeps } from "./stage";

export function createDbBaselineRepo(db: Db): Pick<BaselineDeps, "saveBaseline"> {
  return {
    // One baseline per run; a re-run replaces it.
    async saveBaseline(runId, baseline) {
      await db
        .insert(baselines)
        .values({ runId, ideas: baseline.ideas, verdict: baseline.verdict.sentence })
        .onConflictDoUpdate({ target: baselines.runId, set: { ideas: baseline.ideas, verdict: baseline.verdict.sentence } });
    },
  };
}

// The baseline wired to the database and the language model. Built on first use.
export const baselineStage: StageFn = (ctx) => {
  const db = getDb();
  return createBaselineStage({
    getVenue: createDbVenueRepo(db).getVenue,
    loadPool: createDbDesignerRepo(db).loadPool,
    ...createDbBaselineRepo(db),
    generateStructured,
  })(ctx);
};
