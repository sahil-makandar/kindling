import { eq } from "drizzle-orm";
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
export const baselineStage: StageFn = async (ctx) => {
  const db = getDb();
  // Already written, for example while the clubs were being checked: nothing more to do, and no second trace line.
  const [done] = await db.select({ id: baselines.id }).from(baselines).where(eq(baselines.runId, ctx.run.id));
  if (done) return;
  return createBaselineStage({
    getVenue: createDbVenueRepo(db).getVenue,
    loadPool: createDbDesignerRepo(db).loadPool,
    ...createDbBaselineRepo(db),
    generateStructured,
  })(ctx);
};
