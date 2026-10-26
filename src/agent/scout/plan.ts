import type { AreaSpec } from "@/src/qloo/endpoints";

// The Scout's fixed knowledge: which domains matter for which kind of venue, and how far to widen
// when Qloo has little to say about a small radius.

export const SCOUT_DOMAINS = ["artist", "movie", "tv_show", "book", "podcast", "video_game"] as const;
export type ScoutDomain = (typeof SCOUT_DOMAINS)[number];

// What the plan scans for each kind of venue, most relevant first (PRODUCT_SPEC section 4). Five domains each,
// so the pool has at least four strong ones even when one comes back thin.
const PLANS: Record<string, readonly ScoutDomain[]> = {
  bookstore: ["book", "podcast", "movie", "artist", "tv_show"],
  brewery: ["artist", "tv_show", "video_game", "movie", "podcast"],
  bar: ["artist", "tv_show", "video_game", "movie", "podcast"],
  cafe: ["movie", "book", "artist", "tv_show", "podcast"],
  music_venue: ["artist", "podcast", "movie", "tv_show", "book"],
};
const OTHER_PLAN: readonly ScoutDomain[] = ["artist", "movie", "book", "tv_show", "podcast"];

export function planFor(venueType: string): readonly ScoutDomain[] {
  return PLANS[venueType] ?? OTHER_PLAN;
}

export const DOMAIN_LABEL: Record<ScoutDomain | "place", string> = {
  artist: "music",
  movie: "film",
  tv_show: "TV",
  book: "books",
  podcast: "podcasts",
  video_game: "games",
  place: "places",
};

// The radius ladder from docs/QLOO_API.md section 6. The unit (metres) is confirmed in the live spike.
export const RADIUS_STEPS_M = [1500, 3000, 6000] as const;

// label reads inside a sentence ("within 3 km"); name stands alone ("3 km").
export type LadderStep = { spec: AreaSpec; label: string; name: string; radiusM: number | null };

function kilometres(m: number): string {
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
