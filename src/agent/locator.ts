import { placeCoordinates, type QlooEntity } from "@/src/qloo/schemas";
import { traceEmptyResult } from "./qlooTrace";
import type { StageFn } from "./runStage";

// The Locator finds the venue itself in Qloo's catalogue. Having it means the Scout can ask "what does
// this venue's own crowd love". Not having it is fine: the run reads the neighbourhood instead.
// Matching is plain code (docs/QLOO_API.md quirk 4: place searches return look-alikes such as a record
// store with the same name), so the result is explainable and tested.

export type VenueInput = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  venueType: string;
  // Set once the Locator has found the venue in Qloo.
  qlooEntityId?: string | null;
  qlooEntityName?: string | null;
};

export type VenueMatch = { id: string; name: string; category: string | null };

export type Skipped = { name: string; reason: string };

// Name similarity needed to accept a match without asking the owner.
export const MIN_NAME_SIMILARITY = 0.5;
// A same-named place further away than this is a different business.
export const MAX_DISTANCE_KM = 25;
// The trace names at most this many skipped places, then says how many more.
const MAX_SKIPPED_SHOWN = 3;

// Words in a Qloo category that make a place a plausible Kindling venue.
const VENUE_CATEGORY =
  /\b(cafe|café|coffee|tea|bar|pub|tavern|brewery|taproom|bakery|restaurant|ramen|izakaya|taqueria|dumpling|diner|bistro|eatery|wine|cocktail|lounge|bookstore|book ?shop|book store|music venue|concert|venue|club|community|event)\b/i;

const STOP_WORDS = new Set(["the", "and", "of", "a", "an", "at"]);

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOP_WORDS.has(w)),
  );
}

// Jaccard overlap of the words in two names, 0 to 1.
export function nameSimilarity(a: string, b: string): number {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared += 1;
  return shared / (x.size + y.size - shared);
}

// "112 Bedford Ave, Brooklyn, NY 11249, USA" gives "Brooklyn, NY": enough city context for a name search.
export function cityFromAddress(address: string): string {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const afterStreet = /^\d/.test(parts[0] ?? "") ? parts.slice(1) : parts;
  const cleaned = afterStreet
    .map((p) => p.replace(/\b\d{4,6}(-\d{4})?\b/g, "").trim())
    .filter((p) => p && !/^(usa|us|united states)$/i.test(p));
  return cleaned.slice(0, 2).join(", ");
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// The category that made this place plausible, or the first one we know of.
function categoryOf(hit: QlooEntity): { plausible: boolean; label: string | null } {
  const names = hit.tags.map((t) => t.name);
  const plausible = names.find((n) => VENUE_CATEGORY.test(n));
  if (plausible) return { plausible: true, label: plausible.toLowerCase() };
  // No category information at all: give it the benefit of the doubt.
  return { plausible: names.length === 0, label: names[0]?.toLowerCase() ?? null };
}

export function pickVenueMatch(
  venue: Pick<VenueInput, "name" | "lat" | "lon">,
  hits: QlooEntity[],
): { match: VenueMatch | null; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const accepted: Array<{ hit: QlooEntity; similarity: number; km: number; label: string | null }> = [];

  for (const hit of hits) {
    const similarity = nameSimilarity(venue.name, hit.name);
    if (similarity < MIN_NAME_SIMILARITY) {
      skipped.push({ name: hit.name, reason: "different name" });
      continue;
    }
    const category = categoryOf(hit);
    if (!category.plausible) {
      skipped.push({ name: hit.name, reason: category.label ?? "not a venue" });
      continue;
    }
    const coords = placeCoordinates(hit);
    const km = coords ? distanceKm(venue.lat, venue.lon, coords.lat, coords.lon) : 0;
    if (km > MAX_DISTANCE_KM) {
      skipped.push({ name: hit.name, reason: "too far away" });
      continue;
    }
    accepted.push({ hit, similarity, km, label: category.label });
  }

  accepted.sort((a, b) => b.similarity - a.similarity || a.km - b.km);
  const best = accepted[0];
  return {
    match: best ? { id: best.hit.id, name: best.hit.name, category: best.label } : null,
    skipped,
  };
}

export type LocatorDeps = {
  getVenue(venueId: string): Promise<VenueInput | null>;
  saveMatch(venueId: string, match: VenueMatch): Promise<void>;
  searchPlaces(
    args: { query: string },
    ctx: { runId: string },
  ): Promise<{ items: QlooEntity[]; endpoint: string; params: Record<string, string> }>;
};

export function createLocateStage(deps: LocatorDeps): StageFn {
  return async ({ run, trace }) => {
    const venue = await deps.getVenue(run.venueId);
    if (!venue) throw new Error(`Venue ${run.venueId} not found`);

    const city = cityFromAddress(venue.address);
    await trace.info(`Looking for ${venue.name} on Qloo...`);

    const search = await deps.searchPlaces({ query: `${venue.name} ${city}`.trim() }, { runId: run.id });
    const hits = search.items;
    if (hits.length === 0) await traceEmptyResult(trace, "your venue name", search);
    const { match, skipped } = pickVenueMatch(venue, hits);

    if (skipped.length > 0) {
      const shown = skipped.slice(0, MAX_SKIPPED_SHOWN).map((s) => `${s.name} (${s.reason})`);
      const more = skipped.length - shown.length;
      const list = more > 0 ? `${shown.join(", ")} and ${more} more` : shown.join(", ");
      await trace.info(`Skipped ${skipped.length} look-alike${skipped.length === 1 ? "" : "s"}: ${list}.`);
    }

    if (!match) {
      await trace.warn("Your venue isn't in Qloo's catalogue yet; we'll read the neighbourhood instead.", {
        searched: venue.name,
        resultsSeen: hits.length,
      });
      return;
    }

    await deps.saveMatch(venue.id, match);
    await trace.info(`Found you on Qloo: ${match.name}${match.category ? `, ${match.category}` : ""}.`, {
      entityId: match.id,
    });
  };
}
