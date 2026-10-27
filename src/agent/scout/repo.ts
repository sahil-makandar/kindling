import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db/client";
import { runs, signals } from "@/src/db/schema";
import { flushAllWrites } from "@/src/lib/batcher";
import { qloo } from "@/src/qloo/endpoints";
import { runToolLoop } from "../llm";
import type { StageFn } from "../runStage";
import { createDbVenueRepo } from "../venueRepo";
import type { PoolSignal } from "./pool";
import { createScoutStage, type ScoutDeps } from "./stage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createDbScoutRepo(db: Db): Pick<ScoutDeps, "saveSignals" | "saveRadius"> {
  return {
    async saveSignals(runId, pool: PoolSignal[]) {
      if (pool.length === 0) return;
      // The signals point at rows in the Qloo call log, so the log has to be saved first.
      await flushAllWrites();
      await db
        .insert(signals)
        .values(
          pool.map((s) => ({
            runId,
            refId: s.refId,
            kind: s.kind,
            domain: s.domain,
            source: s.source,
            name: s.name,
            affinity: s.affinity ?? null,
            popularity: s.popularity ?? null,
            tags: s.tags,
            appearances: s.appearances,
            // Only real log rows can be linked (the foreign key points at qloo_calls).
            qlooCallId: s.callId && UUID.test(s.callId) ? s.callId : null,
          })),
        )
        // A stage that is re-run after a crash must not fail on what it already saved.
        .onConflictDoNothing();
    },

    async saveRadius(runId, radiusM) {
      await db.update(runs).set({ radiusM }).where(eq(runs.id, runId));
    },
  };
}

// The Scout wired to the database, the shared Qloo client and the language model. Built on first use so
// that importing this file needs no database connection.
export const scoutStage: StageFn = (ctx) => {
  const db = getDb();
  return createScoutStage({
    getVenue: createDbVenueRepo(db).getVenue,
    ...createDbScoutRepo(db),
    api: qloo,
    runToolLoop,
  })(ctx);
};
