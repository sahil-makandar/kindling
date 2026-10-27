// The two local parts of the club score. Qloo's film, music, TV, book and podcast taste is city-wide, so what makes a
// club fit THIS venue is read from two other places: the tags of the venue's own crowd (the venue on Qloo and venues
// like it) and the tags of the places within 1 km. Both are pure functions over tag names the Scout already collected.

// Words that name a kind of thing rather than a taste. They would match everywhere, so they carry no signal.
const STOP = new Set(["shop", "store", "restaurant", "place", "venue", "event", "music", "film", "movie", "show", "series", "game", "games", "book", "books", "food", "local", "area", "style", "with", "from", "the", "and", "bar", "cafe", "room", "club"]);

export function tagTokens(name: string): string[] {
  return [...new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)))];
}

export type TagUnit = { label: string; tags: string[] };

// One unit is one place (or the venue itself): the tag names it carries. A token's weight is the share of units that have it.
export function tokenShares(units: TagUnit[]): Map<string, { share: number; units: string[] }> {
  const holders = new Map<string, Set<number>>();
  units.forEach((unit, i) => {
    for (const tag of unit.tags) for (const token of tagTokens(tag)) holders.set(token, (holders.get(token) ?? new Set<number>()).add(i));
  });
  const out = new Map<string, { share: number; units: string[] }>();
  for (const [token, set] of holders) out.set(token, { share: set.size / Math.max(1, units.length), units: [...set].map((i) => units[i].label) });
  return out;
}

export type Overlap = { matches: Array<{ token: string; share: number; units: string[] }>; strength: number };

// How much of the club's taste vocabulary shows up among the units. The strength adds up the shares of the matching
// words, capped at 1, so two words found at half the places count as full strength.
export function overlap(clubTags: string[], units: TagUnit[]): Overlap {
  const shares = tokenShares(units);
  const wanted = new Set(clubTags.flatMap(tagTokens));
  const matches = [...wanted]
    .map((token) => ({ token, ...(shares.get(token) ?? { share: 0, units: [] }) }))
    .filter((m) => m.share > 0)
    .sort((a, b) => b.share - a.share);
  return { matches, strength: Math.min(1, matches.reduce((sum, m) => sum + m.share, 0)) };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export type LocalComponent = { value: number; reason: string; callIds: string[]; flagged?: boolean };

const listWords = (matches: Overlap["matches"], limit = 3) => matches.slice(0, limit).map((m) => m.token).join(", ");

// "Places within 1 km": do the places around the door carry the same words as the club, and is one of them in the club?
export function nearbyPlacesComponent(args: {
  clubName: string;
  clubTags: string[];
  places: TagUnit[];
  placeCompanion: string | null;
  callIds: string[];
}): LocalComponent {
  const n = args.places.length;
  if (n === 0) {
    return { value: 0.4, reason: "Qloo returned no places within 1 km, so this part is a neutral guess.", callIds: [], flagged: true };
  }
  const found = overlap(args.clubTags, args.places);
  const value = round3(clamp01(0.15 + (args.placeCompanion ? 0.35 : 0) + 0.5 * found.strength));
  const parts: string[] = [];
  if (args.placeCompanion) parts.push(`${args.placeCompanion} is one of the ${n} places within 1 km, and the club uses it`);
  if (found.matches.length > 0) parts.push(`words in the club's taste (${listWords(found.matches)}) also describe ${found.matches[0].units.length} of the ${n} places nearby`);
  if (parts.length === 0) parts.push(`none of the ${n} places within 1 km share a word with this club's taste`);
  return { value, reason: `${parts.join(". ")}.`, callIds: args.callIds };
}

// "Your venue's crowd": the venue's own Qloo tags and the venues Qloo says are like it. When the venue is not on Qloo, the
// places of the same kind nearby stand in for it, and the component says so.
export function venueCrowdComponent(args: {
  venueName: string;
  clubTags: string[];
  crowd: TagUnit[];
  standIn: TagUnit[];
  callIds: string[];
}): LocalComponent {
  const useStandIn = args.crowd.length === 0;
  const units = useStandIn ? args.standIn : args.crowd;
  if (units.length === 0) {
    return { value: 0.4, reason: `${args.venueName} is not on Qloo and no similar places were found nearby, so its crowd is unknown and this part is a neutral guess.`, callIds: [], flagged: true };
  }
  const found = overlap(args.clubTags, units);
  const value = round3(clamp01(0.15 + 0.85 * found.strength));
  const source = useStandIn ? `${args.venueName} is not on Qloo, so places of the same kind nearby stand in for its crowd` : `${args.venueName} and venues like it on Qloo`;
  const body =
    found.matches.length > 0
      ? `${source}: the club's taste (${listWords(found.matches)}) shows up in ${found.matches[0].units.length} of ${units.length}.`
      : `${source}: none of their tags share a word with this club's taste.`;
  return { value, reason: body, callIds: args.callIds, ...(useStandIn ? { flagged: true } : {}) };
}

// Words in a Qloo place's categories that mean the same kind of place as the venue.
const KIND_WORDS: Record<string, string[]> = {
  cafe: ["coffee", "cafe", "tea", "bakery", "espresso"],
  bookstore: ["book", "library", "bookstore"],
  bar: ["bar", "pub", "cocktail", "wine", "lounge"],
  brewery: ["brewery", "brew", "beer", "taproom", "pub"],
  restaurant: ["restaurant", "dining", "bistro", "kitchen"],
  music_venue: ["music", "concert", "club", "live"],
  community_space: ["community", "center", "gallery", "arts"],
};

export function isSameKind(venueType: string, placeTags: string[]): boolean {
  const words = KIND_WORDS[venueType] ?? [];
  const text = placeTags.join(" ").toLowerCase();
  return words.some((w) => text.includes(w));
}
