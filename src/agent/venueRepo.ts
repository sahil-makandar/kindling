import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/src/db/client";
import { venues } from "@/src/db/schema";
import { searchEntities } from "@/src/qloo/endpoints";
import { createLocateStage, type LocatorDeps } from "./locator";
import type { StageFn } from "./runStage";

export function createDbVenueRepo(db: Db): Pick<LocatorDeps, "getVenue" | "saveMatch"> {
  return {
    async getVenue(venueId) {
      const [row] = await db.select().from(venues).where(eq(venues.id, venueId));
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        address: row.address,
        lat: row.lat,
        lon: row.lon,
        venueType: row.venueType,
      };
    },

    async saveMatch(venueId, match) {
      await db
        .update(venues)
        .set({ qlooEntityId: match.id, qlooEntityName: match.name })
        .where(eq(venues.id, venueId));
    },
  };
}

// The Locator wired to the real database and the shared Qloo client. Built on first use so that
// importing this file does not need a database connection.
export const locateStage: StageFn = (ctx) =>
  createLocateStage({
    ...createDbVenueRepo(getDb()),
    async searchPlaces({ query }, { runId }) {
      const { items } = await searchEntities({ query, types: ["place"], take: 8 }, { purpose: "locate.venue", runId });
      return items;
    },
  })(ctx);
