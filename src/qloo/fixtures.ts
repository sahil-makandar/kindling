import catalogueJson from "@/fixtures/sample/catalogue.json";
import locationsJson from "@/fixtures/sample/locations.json";

// Offline stand-in for the Qloo API (QLOO_MODE=fixtures). It builds responses in the shape described in
// docs/QLOO_API.md section 5 from two hand-written files in fixtures/sample/. The data is sample data,
// not Qloo output, and the UI shows a banner whenever it is in use.

export const ENTITY_DOMAINS = ["artist", "movie", "tv_show", "book", "podcast", "video_game"] as const;
export type MediaDomain = (typeof ENTITY_DOMAINS)[number];

type Params = Record<string, string>;
type Ranking = Array<[string, number]>;

type Catalogue = {
  tags: Record<string, [name: string, type: string]>;
  entities: Record<MediaDomain, Array<[string, string, number, string[], Record<string, unknown>]>>;
  places: Array<[slug: string, name: string, tags: string[], label: string]>;
};

type Location = {
  label: string;
  city: string;
  street: string;
  lon: number;
  lat: number;
  fullDataRadiusM: number;
  cityWords: string[];
  entities: Record<MediaDomain, Ranking>;
  tags: Ranking;
  places: Ranking;
};

const catalogue = catalogueJson as unknown as Catalogue;
const locations = (locationsJson as unknown as { locations: Record<string, Location> }).locations;

export type FixtureLocationKey = "soho" | "williamsburg" | "east_austin" | "logan_square";

export const FIXTURE_LOCATIONS = Object.entries(locations).map(([key, loc]) => ({
  key: key as FixtureLocationKey,
  label: loc.label,
  lon: loc.lon,
  lat: loc.lat,
  fullDataRadiusM: loc.fullDataRadiusM,
}));

type Item = {
  id: string;
  name: string;
  domain: string;
  popularity: number;
  tags: string[];
  properties: Record<string, unknown>;
};

const items = new Map<string, Item>();
for (const domain of ENTITY_DOMAINS) {
  for (const [slug, name, popularity, tags, properties] of catalogue.entities[domain]) {
    items.set(`fx_${slug}`, { id: `fx_${slug}`, name, domain, popularity, tags, properties });
  }
}
const placeHome = new Map<string, string>();
for (const [key, loc] of Object.entries(locations)) {
  for (const [slug] of loc.places) placeHome.set(`fx_place_${slug}`, key);
}
for (const [slug, name, tags, label] of catalogue.places) {
  const id = `fx_place_${slug}`;
  items.set(id, { id, name, domain: "place", popularity: 0.5, tags, properties: { category: label } });
}

// Deterministic pseudo-random number in [0, 1) from a string, so fixtures never change between runs.
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const splitList = (value: string | undefined) => (value ? value.split(",").filter(Boolean) : []);

function tagRef(slug: string) {
  const [name, type] = catalogue.tags[slug] ?? [slug, "keyword"];
  return { id: `fx_tag_${slug}`, name, type: `urn:tag:${type}` };
}

function placeGeo(item: Item) {
  const loc = locations[placeHome.get(item.id) ?? "soho"];
  return {
    lat: Math.round((loc.lat + (hash01(`${item.id}lat`) - 0.5) * 0.008) * 1e5) / 1e5,
    lon: Math.round((loc.lon + (hash01(`${item.id}lon`) - 0.5) * 0.008) * 1e5) / 1e5,
    address: `${100 + Math.floor(hash01(item.id) * 800)} ${loc.street}, ${loc.city}`,
  };
}

function entityBody(item: Item, affinity?: number) {
  let properties = item.properties;
  if (item.domain === "place") {
    const geo = placeGeo(item);
    properties = { ...properties, address: geo.address, geocode: { latitude: geo.lat, longitude: geo.lon } };
  }
  return {
    entity_id: item.id,
    name: item.name,
    type: "urn:entity",
    subtype: `urn:entity:${item.domain}`,
    types: [`urn:entity:${item.domain}`],
    popularity: item.popularity,
    ...(affinity === undefined ? {} : { query: { affinity: round2(affinity) } }),
    properties,
    tags: item.tags.map(tagRef),
  };
}

const insights = (key: string, list: unknown[]) => ({ success: true, results: { [key]: list }, duration: 0 });

function parsePoint(value: string | undefined): { lon: number; lat: number } | undefined {
  const m = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/.exec(value ?? "");
  return m ? { lon: Number(m[1]), lat: Number(m[2]) } : undefined;
}

function distanceKm(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function locationFor(params: Params): { key: string; loc: Location } {
  const point = parsePoint(params["signal.location"] ?? params["filter.location"]);
  if (point) {
    const [key] = Object.entries(locations).sort(([, a], [, b]) => distanceKm(point, a) - distanceKm(point, b))[0];
    return { key, loc: locations[key] };
  }
  const query = (params["signal.location.query"] ?? params["filter.location.query"] ?? "").toLowerCase();
  for (const [key, loc] of Object.entries(locations)) {
    if (loc.cityWords.some((w) => query.includes(w))) return { key, loc };
  }
  return { key: "soho", loc: locations.soho };
}

// Below the location's full-data radius Qloo is "thin": only a few results come back.
// This lets the Scout's radius ladder be tested with realistic behaviour.
function takeFor(params: Params, loc: Location, thinTo = 3): number {
  const take = Number(params.take ?? 15);
  const radius = Number(params["signal.location.radius"] ?? params["filter.location.radius"]);
  const thin = parsePoint(params["signal.location"] ?? params["filter.location"]) && radius < loc.fullDataRadiusM;
  return thin ? Math.min(take, thinTo) : take;
}

// How much of an item's tags are shared with a set of seed items (0 to 1).
function sharedShare(seedIds: string[], item: Item): number {
  const seedTags = new Set<string>();
  for (const id of seedIds) for (const t of items.get(id)?.tags ?? []) seedTags.add(t);
  if (item.tags.length === 0) return 0;
  return item.tags.filter((t) => seedTags.has(t)).length / item.tags.length;
}

function relatedEntities(seedIds: string[], domain: string, take: number) {
  return [...items.values()]
    .filter((it) => it.domain === domain && !seedIds.includes(it.id))
    .map((it) => ({ it, share: sharedShare(seedIds, it) }))
    .filter(({ share }) => share > 0)
    .sort((a, b) => b.share - a.share || a.it.name.localeCompare(b.it.name))
    .slice(0, take)
    .map(({ it, share }) => entityBody(it, 0.35 + 0.6 * share));
}

function areaEntities(params: Params, domain: string) {
  const { loc } = locationFor(params);
  const ranking: Ranking = domain === "place" ? loc.places : (loc.entities[domain as MediaDomain] ?? []);
  let rows = ranking.map(([slug, affinity]) => ({
    item: items.get(domain === "place" ? `fx_place_${slug}` : `fx_${slug}`),
    affinity,
  }));
  if (params["bias.trends"] === "high") {
    // Rising items are a different ordering from all-time favourites.
    rows = [...rows].sort(
      (a, b) =>
        0.4 * b.affinity + 0.6 * hash01(`${b.item?.id}trend`) - (0.4 * a.affinity + 0.6 * hash01(`${a.item?.id}trend`)),
    );
  }
  return rows
    .filter((r): r is { item: Item; affinity: number } => r.item !== undefined)
    .slice(0, takeFor(params, loc))
    .map(({ item, affinity }) => entityBody(item, affinity));
}

function venueCrowd(seedIds: string[], domain: string, take: number) {
  const home = placeHome.get(seedIds[0]) ?? "soho";
  const ranking = locations[home].entities[domain as MediaDomain] ?? [];
  return ranking
    .slice(0, take)
    .map(([slug, affinity]) => {
      const item = items.get(`fx_${slug}`);
      // The venue's own crowd leans a little differently from the whole area.
      return item ? entityBody(item, clamp01(affinity * (0.85 + 0.15 * hash01(`${seedIds[0]}${slug}`)))) : undefined;
    })
    .filter((x) => x !== undefined);
}

function scoreList(params: Params, domain: string) {
  const ids = splitList(params["filter.results.entities"]);
  const seeds = splitList(params["signal.interests.entities"]);
  const { loc } = locationFor(params);
  const areaRanking = new Map(domain === "place" ? [] : (loc.entities[domain as MediaDomain] ?? []).map(([s, a]) => [`fx_${s}`, a]));
  const out: unknown[] = [];
  for (const id of ids) {
    const item = items.get(id);
    if (!item || item.domain !== domain) continue;
    let affinity: number | undefined;
    if (seeds.length > 0) {
      const share = sharedShare(seeds, item);
      if (share > 0) affinity = 0.35 + 0.6 * share;
    } else {
      affinity = areaRanking.get(id);
    }
    // Entities Qloo would not rank for this signal are left out, like the real API.
    if (affinity !== undefined) out.push(entityBody(item, affinity));
  }
  return out;
}

function tagsForSeeds(seedIds: string[], take: number) {
  const known = seedIds.map((id) => items.get(id)).filter((x): x is Item => x !== undefined);
  const counts = new Map<string, number>();
  for (const it of known) for (const t of it.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 0) {
    return ["indie", "comedy", "food", "drama", "cozy"].map((slug) => ({ ...tagRef(slug), query: { affinity: 0.5 } }));
  }
  return [...counts.entries()]
    .map(([slug, count]) => ({
      slug,
      affinity: 0.4 + 0.55 * (count / known.length) + 0.04 * hash01(slug),
    }))
    .sort((a, b) => b.affinity - a.affinity || a.slug.localeCompare(b.slug))
    .slice(0, take)
    .map(({ slug, affinity }) => ({ ...tagRef(slug), query: { affinity: round2(affinity) } }));
}

function heatmap(params: Params) {
  const { loc } = locationFor(params);
  const points: unknown[] = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const lat = round2((loc.lat + i * 0.01) * 1e4) / 1e4;
      const lon = round2((loc.lon + j * 0.01) * 1e4) / 1e4;
      const closeness = 1 - Math.hypot(i, j) / 3.2;
      points.push({
        location: { latitude: lat, longitude: lon, geohash: `fx${i + 2}${j + 2}` },
        query: { affinity: round2(clamp01(0.3 + 0.6 * closeness + 0.1 * hash01(`${lat}${lon}`))), popularity: round2(0.2 + 0.4 * hash01(`${lon}${lat}`)) },
      });
    }
  }
  return insights("heatmap", points);
}

const STOP_WORDS = new Set(["the", "and", "of", "a", "an", "at", "cafe", "bar"]);
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));

function search(params: Params) {
  const query = params.query ?? "";
  const wantedDomains = splitList(params.types).map((t) => t.replace("urn:entity:", ""));
  const take = Number(params.take ?? 8);
  const out: Array<{ score: number; body: unknown }> = [];

  if (wantedDomains.length === 0 || wantedDomains.includes("place")) {
    const queryWords = new Set(words(query));
    for (const item of items.values()) {
      if (item.domain !== "place") continue;
      const score = words(item.name).filter((w) => queryWords.has(w)).length;
      if (score > 0) out.push({ score, body: entityBody(item) });
    }
  }
  const needle = words(query).join(" ");
  const mediaDomains: string[] = wantedDomains.length > 0 ? wantedDomains.filter((d) => d !== "place") : [...ENTITY_DOMAINS];
  if (needle) {
    for (const item of items.values()) {
      if (!mediaDomains.includes(item.domain)) continue;
      if (words(item.name).join(" ").includes(needle)) out.push({ score: 10, body: entityBody(item) });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return { results: out.slice(0, take).map((o) => o.body) };
}

// Returns the fixture response for a Qloo request, in the same shape the live API uses.
export function fixtureResponse(path: string, params: Params): unknown {
  if (path === "/search") return search(params);

  if (path === "/entities") {
    const found = splitList(params.entity_ids).map((id) => items.get(id)).filter((x): x is Item => x !== undefined);
    return { results: found.map((it) => entityBody(it)) };
  }

  if (path === "/v2/tags") {
    const q = (params["filter.query"] ?? "").toLowerCase();
    const matches = Object.keys(catalogue.tags).filter((slug) => catalogue.tags[slug][0].toLowerCase().includes(q));
    return insights("tags", matches.slice(0, Number(params.take ?? 10)).map(tagRef));
  }

  if (path === "/v2/insights") {
    const type = params["filter.type"] ?? "";
    const seeds = splitList(params["signal.interests.entities"]);
    const take = Number(params.take ?? 15);

    if (type === "urn:heatmap") return heatmap(params);

    if (type === "urn:tag") {
      if (seeds.length > 0) return insights("tags", tagsForSeeds(seeds, take));
      const { loc } = locationFor(params);
      return insights(
        "tags",
        loc.tags.slice(0, takeFor(params, loc, 5)).map(([slug, affinity]) => ({ ...tagRef(slug), query: { affinity } })),
      );
    }

    if (type.startsWith("urn:entity:")) {
      const domain = type.replace("urn:entity:", "");
      if (params["filter.results.entities"]) return insights("entities", scoreList(params, domain));
      const hasArea =
        params["signal.location"] || params["filter.location"] || params["signal.location.query"] || params["filter.location.query"];
      if (hasArea) return insights("entities", areaEntities(params, domain));
      if (seeds.length > 0) {
        const crowd = seeds.some((id) => placeHome.has(id))
          ? venueCrowd(seeds, domain, take)
          : relatedEntities(seeds, domain, take);
        return insights("entities", crowd);
      }
    }
  }

  return { success: true, results: {}, duration: 0 };
}
