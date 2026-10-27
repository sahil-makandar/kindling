import type { Db } from "@/src/db/client";
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

export type CreatedRun = { runId: string; venueId: string; location: RunLocation };

export type CreateRunDeps = {
  geocode(address: string): Promise<GeocodeResult | null>;
  save(args: { input: CreateRunInput; location: RunLocation; qlooMode: "fixtures" | "live" | "record" }): Promise<{ runId: string; venueId: string }>;
  qlooMode: "fixtures" | "live" | "record";
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

  const saved = await deps.save({ input, location, qlooMode: deps.qlooMode });
  return { ...saved, location };
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
