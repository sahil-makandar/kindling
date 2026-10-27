import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db/client";
import { candidates, signals } from "@/src/db/schema";
import { generateStructured } from "../llm";
import type { StageFn } from "../runStage";
import { createDbVenueRepo } from "../venueRepo";
import type { PoolSignal, Appearance, SignalSource } from "../scout/pool";
import type { QlooTag } from "@/src/qloo/schemas";
import { createDesignStage, type DesignerDeps } from "./stage";
import type { ClubCandidate } from "./candidates";

export function createDbDesignerRepo(db: Db): Pick<DesignerDeps, "loadPool" | "saveCandidates"> {
  return {
    async loadPool(runId) {
      const rows = await db.select().from(signals).where(eq(signals.runId, runId));
      return rows.map(
        (row): PoolSignal => ({
          refId: row.refId,
          kind: row.kind,
          domain: row.domain,
          ...(row.tagType ? { tagType: row.tagType } : {}),
          source: (row.source ?? "area") as SignalSource,
          name: row.name,
          affinity: row.affinity ?? undefined,
          popularity: row.popularity ?? undefined,
          tags: (row.tags ?? []) as QlooTag[],
          appearances: (row.appearances ?? {}) as Partial<Record<SignalSource, Appearance>>,
          callId: row.qlooCallId,
        }),
      );
    },

    // A re-run replaces the run's ideas instead of adding to them.
    async saveCandidates(runId, list: ClubCandidate[]) {
      await db.delete(candidates).where(eq(candidates.runId, runId));
      if (list.length === 0) return;
      await db.insert(candidates).values(
        list.map((c) => ({
          runId,
          title: c.title,
          anchor: c.anchor,
          companions: c.companions,
          format: c.format,
          why: c.why,
        })),
      );
    },
  };
}

// The Designer wired to the database and the language model. Built on first use.
export const designStage: StageFn = (ctx) => {
  const db = getDb();
  return createDesignStage({
    getVenue: createDbVenueRepo(db).getVenue,
    ...createDbDesignerRepo(db),
    generateStructured,
  })(ctx);
};
