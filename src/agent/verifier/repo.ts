import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db/client";
import { candidates } from "@/src/db/schema";
import { qloo } from "@/src/qloo/endpoints";
import { createDbDesignerRepo } from "../designer/repo";
import type { ClubFormat, PoolRef } from "../designer/candidates";
import type { StageFn } from "../runStage";
import { createDbVenueRepo } from "../venueRepo";
import { createVerifyStage, type StoredCandidate, type VerifierDeps } from "./stage";

export function createDbVerifierRepo(db: Db): Pick<VerifierDeps, "loadCandidates" | "saveScores"> {
  return {
    async loadCandidates(runId) {
      const rows = await db.select().from(candidates).where(eq(candidates.runId, runId));
      return rows.map(
        (row): StoredCandidate => ({
          id: row.id,
          title: row.title,
          anchor: row.anchor as PoolRef,
          companions: row.companions as PoolRef[],
          format: row.format as ClubFormat,
          why: row.why,
        }),
      );
    },

    async saveScores(_runId, rows) {
      for (const row of rows) {
        await db
          .update(candidates)
          .set({ score: row.score, breakdown: row.breakdown, rank: row.rank, verified: row.verified })
          .where(eq(candidates.id, row.id));
      }
    },
  };
}

// The Verifier wired to the database and the shared Qloo client. Built on first use.
export const verifyStage: StageFn = (ctx) => {
  const db = getDb();
  return createVerifyStage({
    getVenue: createDbVenueRepo(db).getVenue,
    loadPool: createDbDesignerRepo(db).loadPool,
    ...createDbVerifierRepo(db),
    api: qloo,
  })(ctx);
};
