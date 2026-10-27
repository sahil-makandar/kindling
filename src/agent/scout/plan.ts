import type { AreaSpec } from "@/src/qloo/endpoints";

// The Scout's fixed knowledge: which domains matter for which kind of venue, and how far to widen
// when Qloo has little to say about a small radius.

// Qloo lists video_game as supported, but the live API answers 400 for it, so it is not scanned.
export const SCOUT_DOMAINS = ["artist", "movie", "tv_show", "book", "podcast"] as const;
export type ScoutDomain = (typeof SCOUT_DOMAINS)[number];

// What the plan scans for each kind of venue, most relevant first (PRODUCT_SPEC section 4). Five domains each,
// so the pool has at least four strong ones even when one comes back thin.
const PLANS: Record<string, readonly ScoutDomain[]> = {
  bookstore: ["book", "podcast", "movie", "artist", "tv_show"],
  brewery: ["artist", "tv_show", "movie", "podcast", "book"],
  bar: ["artist", "tv_show", "movie", "podcast", "book"],
  cafe: ["movie", "book", "artist", "tv_show", "podcast"],
  music_venue: ["artist", "podcast", "movie", "tv_show", "book"],
};
const OTHER_PLAN: readonly ScoutDomain[] = ["artist", "movie", "book", "tv_show", "podcast"];

export function planFor(venueType: string): readonly ScoutDomain[] {
  return PLANS[venueType] ?? OTHER_PLAN;
}

// Qloo answers 400 "does not yet support trending requests" for books; every other domain supports them.
export const TRENDING_DOMAINS: readonly ScoutDomain[] = ["artist", "movie", "tv_show", "podcast"];

export const DOMAIN_LABEL: Record<ScoutDomain | "place", string> = {
  artist: "music",
  movie: "film",
  tv_show: "TV",
  book: "books",
  podcast: "podcasts",
  place: "places",
};

// The radius ladder, in metres (confirmed in the live spike). Qloo's location signal is coarse: at 3 km two different
// neighbourhoods return identical lists, and below about 500 m the answer stops changing, so the ladder stays local.
export const RADIUS_STEPS_M = [500, 1000, 2000] as const;

// label reads inside a sentence ("within 3 km"); name stands alone ("3 km").
export type LadderStep = { spec: AreaSpec; label: string; name: string; radiusM: number | null };

function kilometres(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
}

// The steps from the closest look to the widest. The last step is the whole city, if we know its name.
export function buildLadder(center: { lon: number; lat: number }, city: string | null): LadderStep[] {
  const steps: LadderStep[] = RADIUS_STEPS_M.map((radiusM) => ({
    spec: { lon: center.lon, lat: center.lat, radiusM },
    label: `within ${kilometres(radiusM)}`,
    name: kilometres(radiusM),
    radiusM,
  }));
  if (city) steps.push({ spec: { city }, label: `across ${city}`, name: `all of ${city}`, radiusM: null });
  return steps;
}
