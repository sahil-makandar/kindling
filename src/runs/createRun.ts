import { z } from "zod";
import type { Db } from "@/src/db/client";
import { runs, venues } from "@/src/db/schema";
import type { GeocodeCandidate, GeocodeResult } from "@/src/geo/geocode";
import { HttpError } from "./http";

export const VENUE_TYPES = ["cafe", "bookstore", "bar", "brewery", "restaurant", "music_venue", "community_space"] as const;
export const NIGHTS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

// What the landing form sends. lat and lon are given together when the person picked a preset, a different match from the
// address lookup, or a spot on the map; then the address is not looked up again.
export const createRunSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your venue's name.").max(80, "That name is too long."),
    address: z.string().trim().min(3, "Enter the venue's address.").max(200, "That address is too long."),
    venueType: z.enum(VENUE_TYPES, "Pick the kind of venue."),
    slowNight: z.enum(NIGHTS, "Pick your slowest night."),
    baselineHeadcount: z.number().int().min(0).max(1000).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    matchedAddress: z.string().trim().max(300).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lon === undefined), { message: "Give both a latitude and a longitude, or neither.", path: ["lat"] });
export type CreateRunInput = z.infer<typeof createRunSchema>;

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
