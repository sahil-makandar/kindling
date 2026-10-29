import type { ClubFormat } from "@/src/agent/designer/candidates";

// The club score: a transparent, deterministic 0 to 100. Every component is a value
// from 0 to 1 with a plain-English reason and the Qloo calls it came from, so the page can show exactly why a club
// ranks where it does. Everything here is a pure function; the Verifier stage gathers the inputs.

export const COMPONENTS = ["cityCulture", "venueCrowd", "nearbyPlaces", "coherence", "momentum", "sweetSpot", "formatFit"] as const;
export type ComponentName = (typeof COMPONENTS)[number];

// Qloo's media taste is city-wide, so the two parts that read this venue and its surroundings carry more weight than the
// city's culture does: 0.20 the venue's crowd, 0.15 the places within 1 km, 0.15 the city's culture.
export const WEIGHTS: Record<ComponentName, number> = {
  cityCulture: 0.15,
  venueCrowd: 0.2,
  nearbyPlaces: 0.15,
  coherence: 0.15,
  momentum: 0.1,
  sweetSpot: 0.1,
  formatFit: 0.15,
};

// How far each part of the score reaches, in the words shown on screen.
export const SCOPE_LABEL: Record<ComponentName, string> = {
  cityCulture: "your city's culture",
  venueCrowd: "your venue's crowd",
  nearbyPlaces: "places within 1 km",
  coherence: "how the club fits together",
  momentum: "rising in your city",
  sweetSpot: "your city's culture",
  formatFit: "a rule for your kind of venue",
};

export type Component = {
  value: number;
  reason: string;
  // Rows in qloo_calls that produced the evidence. Empty when the value comes from a rule, not a call.
  callIds: string[];
  // True when the value is a default because the evidence was missing, so the page can say so.
  flagged?: boolean;
};

export type Breakdown = Record<ComponentName, Component>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// ---- format fit ----

export const FORMAT_FIT: Record<string, Record<ClubFormat, number>> = {
  cafe: { discussion_club: 0.9, listening_night: 0.7, book_club: 0.9, game_night: 0.7, trivia_night: 0.6, fan_meetup: 0.8, tasting: 0.7 },
  bookstore: { discussion_club: 0.9, listening_night: 0.6, book_club: 1.0, game_night: 0.6, trivia_night: 0.7, fan_meetup: 0.8, tasting: 0.5 },
  bar: { discussion_club: 0.6, listening_night: 0.9, book_club: 0.5, game_night: 0.8, trivia_night: 1.0, fan_meetup: 0.8, tasting: 0.8 },
  brewery: { discussion_club: 0.6, listening_night: 0.8, book_club: 0.5, game_night: 0.9, trivia_night: 1.0, fan_meetup: 0.8, tasting: 0.9 },
  restaurant: { discussion_club: 0.6, listening_night: 0.6, book_club: 0.5, game_night: 0.5, trivia_night: 0.7, fan_meetup: 0.7, tasting: 1.0 },
  music_venue: { discussion_club: 0.5, listening_night: 1.0, book_club: 0.4, game_night: 0.6, trivia_night: 0.8, fan_meetup: 0.9, tasting: 0.6 },
  community_space: { discussion_club: 0.9, listening_night: 0.7, book_club: 0.9, game_night: 0.9, trivia_night: 0.8, fan_meetup: 0.9, tasting: 0.6 },
};

export function formatFitValue(venueType: string, format: ClubFormat): number {
  return (FORMAT_FIT[venueType] ?? FORMAT_FIT.community_space)[format];
}

// ---- sweet spot ----

// A theme should be known enough to draw a crowd and niche enough to feel like identity. r is the anchor's
// popularity as a percentile within the pool (0 least popular, 1 most), because Qloo's raw popularity bunches near 1.
export function sweetSpot(r: number): number {
  return Math.exp(-((r - 0.6) ** 2) / (2 * 0.2 ** 2));
}

// Share of values below this one, counting ties as half. 0 is the least popular, 1 the most.
export function percentileRank(value: number, values: number[]): number {
  if (values.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  return (below + equal / 2) / values.length;
}

// ---- component builders ----

export const AREA_SCAN_SIZE = 15;

// How strongly the city loves the anchor (Qloo reads media taste for the whole city, not the block). Qloo's affinity for an area's top results is between 0.99 and 1.0, so raw
// affinity cannot rank anything. Position in the scan and the affinity rescaled within the domain's range both count.
export function cityCultureComponent(args: {
  anchorName: string;
  domainLabel: string;
  rank: number | null;
  affinity: number | null;
  range: { min: number; max: number } | null;
  callId: string | null;
}): Component {
  const { rank, affinity, range } = args;
  if (rank === null || affinity === null) {
    return {
      value: 0.5,
      reason: `${args.anchorName} was not in the city scan for ${args.domainLabel}, so its strength is a neutral guess.`,
      callIds: [],
      flagged: true,
    };
  }
  const rankScore = clamp01(1 - rank / (AREA_SCAN_SIZE - 1));
  const rescaled = range && range.max > range.min ? clamp01((affinity - range.min) / (range.max - range.min)) : 1;
  const value = round(0.5 * rankScore + 0.5 * rescaled, 3);
  return {
    value,
    reason: `Number ${rank + 1} of ${AREA_SCAN_SIZE} in what your city loves in ${args.domainLabel} (affinity ${affinity.toFixed(3)}, ${Math.round(rescaled * 100)}% of the way up its range).`,
    callIds: args.callId ? [args.callId] : [],
  };
}

export type CompanionEvidence =
  // Qloo ranked this companion for fans of the anchor (affinity), or did not (null).
  | { kind: "scored"; name: string; affinity: number | null }
  // A genre or theme tag: supported when the anchor itself carries it.
  | { kind: "tag"; name: string; carriedByAnchor: boolean }
  // A nearby place: part of the plan, but Qloo cannot rate it against a film or song.
  | { kind: "place"; name: string };

export const DEFAULT_COHERENCE = 0.3;
// An entity Qloo did not rank for this anchor counts as low, not as an error.
const UNRANKED_AFFINITY = 0.1;
const TAG_SUPPORTED = 0.9;
const TAG_UNSUPPORTED = 0.4;

// How well the companions go with the anchor: the mean affinity of the companions Qloo can score for fans of the anchor.
export function coherenceComponent(args: { anchorName: string; companions: CompanionEvidence[]; callIds: string[]; verified: boolean }): Component {
  // Places cannot be rated against a film or song. Companions Qloo was never asked about are unknown, which is not the
  // same as "Qloo did not rank them", so they are left out of the mean rather than counted as low.
  const scorable = args.companions.filter(
    (c): c is Exclude<CompanionEvidence, { kind: "place" }> => c.kind !== "place" && (args.verified || c.kind === "tag"),
  );
  if (scorable.length === 0) {
    return {
      value: DEFAULT_COHERENCE,
      reason: args.verified
        ? "The companions are places, which Qloo cannot rate against a film or song, so coherence uses the default."
        : "Not checked with Qloo (only the top clubs are), so coherence uses the default.",
      callIds: [],
      flagged: true,
    };
  }
  const values = scorable.map((c) => {
    if (c.kind === "scored") return c.affinity ?? UNRANKED_AFFINITY;
    return c.carriedByAnchor ? TAG_SUPPORTED : TAG_UNSUPPORTED;
  });
  const value = round(values.reduce((a, b) => a + b, 0) / values.length, 3);
  const parts = scorable.map((c, i) => {
    if (c.kind === "scored") return c.affinity === null ? `${c.name} not ranked by Qloo` : `${c.name} ${values[i].toFixed(2)}`;
    return c.carriedByAnchor ? `${c.name} is a tag ${args.anchorName} carries` : `${c.name} is not one of ${args.anchorName}'s tags`;
  });
  return {
    value,
    reason: `For fans of ${args.anchorName}: ${parts.join("; ")}. Mean ${value.toFixed(2)}.${args.verified ? "" : " The other companions were not checked with Qloo."}`,
    callIds: args.callIds,
    // Judged from the anchor's own tags only, so it is a partial answer.
    ...(args.verified ? {} : { flagged: true }),
  };
}

// Is the anchor rising here? 1.0 for the top 5 of the trend results, 0.6 for the top 15, 0.3 otherwise. Books have no
// trend data in Qloo (the API answers 400), so they get a neutral value rather than a penalty.
export function momentumComponent(args: { anchorName: string; trendRank: number | null; supported: boolean; callId: string | null }): Component {
  if (!args.supported) {
    return { value: 0.5, reason: "Qloo has no trend data for this kind of thing yet, so momentum is neutral.", callIds: [], flagged: true };
  }
  if (args.trendRank === null) {
    return { value: 0.3, reason: `${args.anchorName} was not among what is rising in your city.`, callIds: [] };
  }
  const value = args.trendRank < 5 ? 1 : args.trendRank < 15 ? 0.6 : 0.3;
  return {
    value,
    reason: `${args.anchorName} is number ${args.trendRank + 1} of what is rising in your city.`,
    callIds: args.callId ? [args.callId] : [],
  };
}

export function sweetSpotComponent(args: { anchorName: string; popularity: number | null; percentile: number | null }): Component {
  if (args.popularity === null || args.percentile === null) {
    return { value: 0.5, reason: `Qloo gives no popularity for ${args.anchorName}, so this is a neutral guess.`, callIds: [], flagged: true };
  }
  const value = round(sweetSpot(args.percentile), 3);
  const where = args.percentile < 0.35 ? "very niche" : args.percentile > 0.85 ? "a household name" : "well known without being everywhere";
  return {
    value,
    reason: `${args.anchorName} sits at the ${Math.round(args.percentile * 100)}th percentile of popularity among what your city loves: ${where}. The best spot is around the 60th.`,
    callIds: [],
  };
}

export function formatFitComponent(args: { venueType: string; format: ClubFormat; formatLabel: string }): Component {
  const value = formatFitValue(args.venueType, args.format);
  return {
    value,
    reason: `A ${args.formatLabel.toLowerCase()} suits a ${args.venueType.replace("_", " ")} at ${Math.round(value * 100)} out of 100.`,
    callIds: [],
  };
}

// ---- the score ----

export function scoreClub(breakdown: Breakdown): { score: number; breakdown: Breakdown } {
  let total = 0;
  for (const name of COMPONENTS) total += WEIGHTS[name] * clamp01(breakdown[name].value);
  return { score: round(100 * total, 1), breakdown };
}

// Highest score first. Ties break on title so the order never changes between runs.
export function rankScored<T extends { score: number; title: string }>(scored: T[]): T[] {
  return [...scored].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
