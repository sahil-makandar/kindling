import type { Db } from "@/src/db/client";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { runs, venues } from "@/src/db/schema";
import type { GeocodeCandidate, GeocodeResult } from "@/src/geo/geocode";
import { HttpError } from "./http";
import { createRunSchema, type CreateRunInput } from "./schema";

export { createRunSchema, type CreateRunInput };

export type RunLocation = {
  lat: number;
  lon: number;
  displayName: string;
  source: "given" | "geocoded";
  alternatives: GeocodeCandidate[];
};

// cached is true when a finished run for the same venue was reused, so nothing new was started.
export type CreatedRun = { runId: string; venueId: string; location: RunLocation; cached: boolean };

export const RUN_CACHE_HOURS = 24;

const normaliseName = (name: string): string => name.trim().toLowerCase().split(/\s+/).join(" ");

// Two requests are the same venue when the name, the spot (to about 10 m), the kind of venue and the night match.
export function runCacheKey(input: Pick<CreateRunInput, "name" | "venueType" | "slowNight">, location: Pick<RunLocation, "lat" | "lon">): string {
  return [normaliseName(input.name), location.lat.toFixed(4), location.lon.toFixed(4), input.venueType, input.slowNight].join("|");
}

export type CreateRunDeps = {
  geocode(address: string): Promise<GeocodeResult | null>;
  save(args: { input: CreateRunInput; location: RunLocation; qlooMode: "fixtures" | "live" | "record" }): Promise<{ runId: string; venueId: string }>;
  qlooMode: "fixtures" | "live" | "record";
  // A finished run for the same venue from the last day, if there is one. Reusing it costs no Qloo or model calls.
  findCached?(input: CreateRunInput, location: RunLocation): Promise<{ runId: string; venueId: string } | null>;
  // Called just before a new run is saved, for the per-IP allowance. A reused run never gets here, so it does not count.
  beforeCreate?(): Promise<void>;
};

export async function createRun(raw: unknown, deps: CreateRunDeps): Promise<CreatedRun> {
  const input = createRunSchema.parse(raw);

  let location: RunLocation;
  if (input.lat !== undefined && input.lon !== undefined) {
    location = { lat: input.lat, lon: input.lon, displayName: input.matchedAddress ?? input.address, source: "given", alternatives: [] };
  } else {
    const found = await deps.geocode(input.address);
    if (!found) {
      throw new HttpError(422, "We could not find that address. Check the spelling, add the city, or pick a spot on the map.");
    }
    location = { lat: found.lat, lon: found.lon, displayName: found.displayName, source: "geocoded", alternatives: found.alternatives };
  }

  const cached = await deps.findCached?.(input, location);
  if (cached) return { ...cached, location, cached: true };

  await deps.beforeCreate?.();
  const saved = await deps.save({ input, location, qlooMode: deps.qlooMode });
  return { ...saved, location, cached: false };
}

// Saves the venue and its run together, so a failure cannot leave a venue without a run.
export function createDbRunWriter(db: Db): CreateRunDeps["save"] {
  return ({ input, location, qlooMode }) =>
    db.transaction(async (tx) => {
      const [venue] = await tx
        .insert(venues)
        .values({
          name: input.name,
          address: input.address,
          lat: location.lat,
          lon: location.lon,
          venueType: input.venueType,
          slowNight: input.slowNight,
          baselineHeadcount: input.baselineHeadcount ?? null,
          matchedAddress: location.displayName,
          addressAlternatives: location.alternatives,
        })
        .returning({ id: venues.id });
      const [run] = await tx.insert(runs).values({ venueId: venue.id, qlooMode }).returning({ id: runs.id });
      return { runId: run.id, venueId: venue.id };
    });
}

// The newest finished run for the same venue in the same Qloo mode within the last day. Demo venues are never reused.
export function createDbRunFinder(db: Db): NonNullable<CreateRunDeps["findCached"]> {
  return async (input, location) => {
    const since = new Date(Date.now() - RUN_CACHE_HOURS * 3_600_000);
    const [row] = await db
      .select({ runId: runs.id, venueId: venues.id, mode: runs.qlooMode })
      .from(runs)
      .innerJoin(venues, eq(venues.id, runs.venueId))
      .where(
        and(
          eq(runs.status, "done"),
          gt(runs.startedAt, since),
          eq(venues.isDemo, false),
          sql`lower(${venues.name}) = ${normaliseName(input.name)}`,
          sql`round(${venues.lat}::numeric, 4) = ${location.lat.toFixed(4)}::numeric`,
          sql`round(${venues.lon}::numeric, 4) = ${location.lon.toFixed(4)}::numeric`,
          eq(venues.venueType, input.venueType),
          eq(venues.slowNight, input.slowNight),
        ),
      )
      .orderBy(desc(runs.startedAt))
      .limit(1);
    return row ? { runId: row.runId, venueId: row.venueId } : null;
  };
}
