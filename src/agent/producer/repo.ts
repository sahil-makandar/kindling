import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db/client";
import { candidates, clubs, venues } from "@/src/db/schema";
import { cityFromAddress } from "../locator";
import { generateStructured } from "../llm";
import { createDbDesignerRepo } from "../designer/repo";
import type { ClubFormat, PoolRef } from "../designer/candidates";
import { createProduceKit, type ProducerDeps } from "./stage";
import type { ClubKit } from "./kit";

export function createDbProducerRepo(db: Db): Pick<ProducerDeps, "loadClub" | "saveKit"> {
  return {
    async loadClub(clubId) {
      const [row] = await db
        .select({ club: clubs, venue: venues, candidate: candidates })
        .from(clubs)
        .innerJoin(venues, eq(venues.id, clubs.venueId))
        .innerJoin(candidates, eq(candidates.id, clubs.candidateId))
        .where(eq(clubs.id, clubId));
      if (!row || !row.club.runId) return null;

      const pool = await createDbDesignerRepo(db).loadPool(row.club.runId);
      return {
        runId: row.club.runId,
        kit: (row.club.kit as ClubKit | null) ?? null,
        pool,
        context: {
          venueName: row.venue.name,
          venueType: row.venue.venueType,
          slowNight: row.venue.slowNight,
          city: cityFromAddress(row.venue.address).split(",")[0]?.trim() || null,
          title: row.candidate.title,
          format: row.candidate.format as ClubFormat,
          why: row.candidate.why,
          anchor: row.candidate.anchor as PoolRef,
          companions: row.candidate.companions as PoolRef[],
        },
      };
    },

    async saveKit(clubId, kit) {
      await db.update(clubs).set({ kit, title: kit.clubName }).where(eq(clubs.id, clubId));
    },
  };
}

// The Producer wired to the database and the language model. Built on first use.
export const produceKit = (clubId: string) => {
  const db = getDb();
  return createProduceKit({ ...createDbProducerRepo(db), generateStructured })(clubId);
};
