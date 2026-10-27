import { DOMAIN_LABEL, planFor, SCOUT_DOMAINS, type ScoutDomain } from "../scout/plan";
import type { PoolSignal } from "../scout/pool";

// The Designer's pure logic (PRODUCT_SPEC section 5.1). The model proposes "hidden clubs", each built on things the
// Scout actually found. To make invented ids impossible, the model never sees Qloo ids: it sees short aliases (m1, a3,
// l2) and cites those, and this file maps them back to real pool signals and drops anything that does not resolve.

export const CLUB_FORMATS = [
  "discussion_club",
  "listening_night",
  "book_club",
  "game_night",
  "trivia_night",
  "fan_meetup",
  "tasting",
] as const;
export type ClubFormat = (typeof CLUB_FORMATS)[number];

export const FORMAT_LABEL: Record<ClubFormat, string> = {
  discussion_club: "Discussion club",
  listening_night: "Listening night",
  book_club: "Book club",
  game_night: "Game night",
  trivia_night: "Trivia night",
  fan_meetup: "Fan meetup",
  tasting: "Tasting",
};

// A reference to something in the pool. domain is "tag" for tags.
export type PoolRef = { id: string; kind: "entity" | "tag"; domain: string; name: string };

export type ClubCandidate = {
  title: string;
  anchor: PoolRef;
  companions: PoolRef[];
  format: ClubFormat;
  why: string;
};

// What the model writes: aliases instead of ids.
export type RawCandidate = { title: string; anchor: string; companions: string[]; format: ClubFormat; why: string };

export type PromptItem = { alias: string; name: string; popularity?: number; tags: string[]; rising: boolean };

export type PromptView = {
  domains: Array<{ domain: ScoutDomain; items: PromptItem[] }>;
  places: Array<{ alias: string; name: string; categories: string[] }>;
  themeTags: Array<{ alias: string; name: string }>;
  vibeTags: Array<{ alias: string; name: string }>;
  venueTags: string[];
};

// How many of each thing the model gets to see. Enough to be creative, small enough to be fast.
const DISTINCTIVE_PER_DOMAIN = 8;
const MAINSTREAM_PER_DOMAIN = 3;
const MAX_PLACES = 10;
const MAX_THEME_TAGS = 14;
const MAX_VIBE_TAGS = 10;
// Popularity above this is a household name. Qloo's area favourites are dominated by them.
const MAINSTREAM_POPULARITY = 0.9;

export const MIN_CANDIDATES = 6;
export const MAX_CANDIDATES = 8;

const PREFIX: Record<ScoutDomain | "place", string> = { artist: "a", movie: "m", tv_show: "t", book: "b", podcast: "p", place: "l" };

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g");

// Text from a model is shown to people, so keep it to plain hyphens and tidy spacing.
export function plain(text: string): string {
  return text.replace(DASHES, "-").replace(/\s+/g, " ").trim();
}

const bestAreaRank = (s: PoolSignal) => s.appearances.area?.rank ?? Number.MAX_SAFE_INTEGER;

const isTasteTag = (s: PoolSignal) => /:(genre|theme|style|archetype|audience):/.test(s.tagType ?? "");
const isVibeTag = (s: PoolSignal) => /:(ambience|setting|interests|activity_type|neighborhood_characteristic|visit_intent|decor):/.test(s.tagType ?? "");

function categoriesOf(place: PoolSignal): string[] {
  const named = place.tags.filter((t) => /category|genre/.test(t.type ?? "")).map((t) => t.name);
  return (named.length > 0 ? named : place.tags.map((t) => t.name)).slice(0, 3);
}

// Gives the signals the model may use short aliases, and builds the compact view that goes in the prompt.
export function buildAliasTable(pool: PoolSignal[]): { aliases: Map<string, PoolSignal>; view: PromptView } {
  const aliases = new Map<string, PoolSignal>();
  const counters: Record<string, number> = {};
  const assign = (prefix: string, signal: PoolSignal): string => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const alias = `${prefix}${counters[prefix]}`;
    aliases.set(alias, signal);
    return alias;
  };

  const domains: PromptView["domains"] = [];
  for (const domain of SCOUT_DOMAINS) {
    const known = pool
      .filter((s) => s.kind === "entity" && s.domain === domain && s.appearances.area)
      .sort((a, b) => bestAreaRank(a) - bestAreaRank(b));
    const distinctive = known.filter((s) => (s.popularity ?? 0) <= MAINSTREAM_POPULARITY).slice(0, DISTINCTIVE_PER_DOMAIN);
    const mainstream = known.filter((s) => (s.popularity ?? 0) > MAINSTREAM_POPULARITY).slice(0, MAINSTREAM_PER_DOMAIN);
    const items = [...distinctive, ...mainstream].map((s) => ({
      alias: assign(PREFIX[domain], s),
      name: s.name,
      popularity: s.popularity === undefined ? undefined : Math.round(s.popularity * 100) / 100,
      tags: s.tags.slice(0, 4).map((t) => t.name),
      rising: (s.appearances.trend?.rank ?? 99) < 5,
    }));
    if (items.length > 0) domains.push({ domain, items });
  }

  const placeSignals = pool
    .filter((s) => s.kind === "entity" && s.domain === "place")
    .sort((a, b) => Number(Boolean(b.appearances.places)) - Number(Boolean(a.appearances.places)) || bestPlaceRank(a) - bestPlaceRank(b))
    .slice(0, MAX_PLACES);
  const places = placeSignals.map((s) => ({ alias: assign(PREFIX.place, s), name: s.name, categories: categoriesOf(s) }));

  const byAffinity = (a: PoolSignal, b: PoolSignal) => (b.affinity ?? 0) - (a.affinity ?? 0);
  const areaTags = pool.filter((s) => s.kind === "tag" && s.source !== "venue");
  const themeTags = areaTags.filter(isTasteTag).sort(byAffinity).slice(0, MAX_THEME_TAGS).map((s) => ({ alias: assign("g", s), name: s.name }));
  const vibeTags = areaTags.filter(isVibeTag).sort(byAffinity).slice(0, MAX_VIBE_TAGS).map((s) => ({ alias: assign("v", s), name: s.name }));
  const venueTags = pool.filter((s) => s.kind === "tag" && s.source === "venue").map((s) => s.name).slice(0, 8);

  return { aliases, view: { domains, places, themeTags, vibeTags, venueTags } };
}

function bestPlaceRank(s: PoolSignal): number {
  return Math.min(s.appearances.places?.rank ?? 999, s.appearances.venue?.rank ?? 999);
}

export function toRef(signal: PoolSignal): PoolRef {
  return {
    id: signal.refId,
    kind: signal.kind,
    domain: signal.kind === "tag" ? "tag" : (signal.domain ?? "tag"),
    name: signal.name,
  };
}

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

// Where a long title can be cut: a colon, an opening bracket, a spaced hyphen, or an en or em dash.
const TITLE_BREAK = new RegExp(`[:(${String.fromCharCode(0x2013, 0x2014)}]|\\s-\\s`);

// "Daytime Revolution: the film" gives "Daytime Revolution". Used in titles and templates.
export function shortName(name: string, maxWords = 3): string {
  const head = name.split(TITLE_BREAK)[0] ?? name;
  return wordsOf(head).slice(0, maxWords).join(" ");
}

function trimTitle(title: string): string {
  return wordsOf(plain(title)).slice(0, 6).join(" ");
}

const mentions = (text: string, name: string) =>
  text.toLowerCase().includes(name.toLowerCase()) || text.toLowerCase().includes(shortName(name).toLowerCase());

export function templateWhy(anchor: PoolRef, companions: PoolRef[]): string {
  const withCompanions = companions.map((c) => c.name).join(" and ");
  return `${anchor.name} stands out in this area, and it pairs with ${withCompanions} from different corners of the same crowd.`;
}

// Turns what the model wrote into clubs built only from things in the pool. Anything that does not hold up is
// dropped, with a plain reason for the trace.
export function resolveCandidates(
  raw: RawCandidate[],
  aliases: Map<string, PoolSignal>,
): { kept: ClubCandidate[]; dropped: Array<{ title: string; reason: string }> } {
  const kept: ClubCandidate[] = [];
  const dropped: Array<{ title: string; reason: string }> = [];
  const usedAnchors = new Set<string>();

  for (const candidate of raw) {
    const title = trimTitle(candidate.title);
    const drop = (reason: string) => dropped.push({ title: title || "an idea", reason });

    const anchorSignal = aliases.get(candidate.anchor);
    if (!anchorSignal) {
      drop("it used something that Qloo never returned for this area");
      continue;
    }
    if (usedAnchors.has(anchorSignal.refId)) {
      drop("another idea already uses the same anchor");
      continue;
    }

    const companions: PoolSignal[] = [];
    let unknown = false;
    for (const alias of candidate.companions) {
      const signal = aliases.get(alias);
      if (!signal) {
        unknown = true;
        continue;
      }
      if (signal.refId !== anchorSignal.refId && !companions.some((c) => c.refId === signal.refId)) companions.push(signal);
    }
    if (unknown && companions.length === 0) {
      drop("it used something that Qloo never returned for this area");
      continue;
    }

    const anchor = toRef(anchorSignal);
    // Companions come from other domains than the anchor, so a club crosses taste instead of repeating it.
    const crossing = companions.filter((c) => (c.kind === "tag" ? "tag" : c.domain) !== anchor.domain);
    if (crossing.length === 0) {
      drop("its companions must come from a different domain than the anchor");
      continue;
    }

    const refs = crossing.slice(0, 2).map(toRef);
    const why = plain(candidate.why);
    kept.push({
      title,
      anchor,
      companions: refs,
      format: candidate.format,
      why: mentions(why, anchor.name) ? why : templateWhy(anchor, refs),
    });
    usedAnchors.add(anchorSignal.refId);
    if (kept.length >= MAX_CANDIDATES) break;
  }
  return { kept, dropped };
}

// ---- the standard plan: used when no model can answer, and to top up when too few ideas survive ----

const TITLE_SUFFIX: Record<ClubFormat, string> = {
  discussion_club: "Club",
  listening_night: "Listening Night",
  book_club: "Book Club",
  game_night: "Game Night",
  trivia_night: "Trivia Night",
  fan_meetup: "Fan Night",
  tasting: "Tasting Night",
};

function formatFor(domain: ScoutDomain, venueType: string, hasPlaceCompanion: boolean): ClubFormat {
  if (domain === "book") return "book_club";
  if (domain === "artist") return hasPlaceCompanion ? "tasting" : "listening_night";
  const drinksVenue = venueType === "bar" || venueType === "brewery";
  if (domain === "tv_show") return drinksVenue ? "trivia_night" : "fan_meetup";
  return "discussion_club";
}

const normal = (name: string) => name.trim().toLowerCase();

// Builds clubs from the pool with plain rules: the strongest distinctive picks of each domain, each paired with the
// other-domain pick that shares the most genre or theme tags, and a nearby place when there is one.
export function standardCandidates(
  view: PromptView,
  aliases: Map<string, PoolSignal>,
  venueType: string,
  count: number,
  usedAnchors: ReadonlySet<string> = new Set(),
): RawCandidate[] {
  const out: RawCandidate[] = [];
  const used = new Set(usedAnchors);
  const planOrder = planFor(venueType);
  const byDomain = new Map(view.domains.map((d) => [d.domain, d.items]));
  const ordered = [...planOrder, ...SCOUT_DOMAINS.filter((d) => !planOrder.includes(d))].filter((d) => byDomain.has(d));

  // Two rounds, so the first club of every domain comes before the second of any.
  for (let round = 0; round < 2 && out.length < count; round++) {
    for (const domain of ordered) {
      if (out.length >= count) break;
      const anchorItem = (byDomain.get(domain) ?? []).filter((i) => !used.has(aliases.get(i.alias)?.refId ?? i.alias))[0];
      if (!anchorItem) continue;
      const anchorSignal = aliases.get(anchorItem.alias);
      if (!anchorSignal) continue;

      const shared = (item: PromptItem) => item.tags.filter((t) => anchorItem.tags.some((a) => normal(a) === normal(t))).length;
      const others = view.domains
        .filter((d) => d.domain !== domain)
        .flatMap((d) => d.items.slice(0, 5))
        .sort((a, b) => shared(b) - shared(a));
      const companion = others[0];
      if (!companion) continue;
      const place = view.places[0];
      const companions = [companion.alias, ...(place && round === 0 ? [place.alias] : [])];

      const format = formatFor(domain, venueType, companions.length > 1 && domain === "artist");
      const sharedTags = anchorItem.tags.filter((t) => companion.tags.some((c) => normal(c) === normal(t))).slice(0, 2);
      const evidence = sharedTags.length > 0 ? ` because they share ${sharedTags.join(" and ")}` : " because both are loved in this area";
      out.push({
        title: `${shortName(anchorItem.name)} ${TITLE_SUFFIX[format]}`,
        anchor: anchorItem.alias,
        companions,
        format,
        why: `${anchorItem.name} stands out in this area and pairs with ${companion.name}${evidence}.`,
      });
      used.add(anchorSignal.refId);
    }
  }
  return out;
}

export { DOMAIN_LABEL };
