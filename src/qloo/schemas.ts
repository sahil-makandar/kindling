import { z } from "zod";

// Response shapes as measured in the live spike. Everything is loose (unknown
// fields are kept) and optional, so a surprise in the real API becomes a warning in the trace, not a crash.
// The rest of the code only sees the normalised types below, never raw Qloo field names.

const queryBlock = z.looseObject({
  affinity: z.number().optional(),
  popularity: z.number().optional(),
});

// Tags are written two ways: { id, name, type } inside insights entities, and { tag_id, name, type } inside
// search and entity lookups. Standalone tag lists use { tag_id, types, subtype } or { id, type }.
const tagRefSchema = z.looseObject({
  id: z.string().optional(),
  tag_id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  types: z.array(z.string()).optional(),
  subtype: z.string().optional(),
});

export const entitySchema = z.looseObject({
  entity_id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  subtype: z.string().optional(),
  types: z.array(z.string()).optional(),
  popularity: z.number().optional(),
  query: queryBlock.optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(tagRefSchema).optional(),
  // Places carry their coordinates here (not in properties.geocode, which only names the area).
  location: z.looseObject({ lat: z.number().optional(), lon: z.number().optional() }).optional(),
  disambiguation: z.string().optional(),
});

export const tagSchema = tagRefSchema.extend({
  name: z.string(),
  query: queryBlock.optional(),
});

export const heatmapPointSchema = z.looseObject({
  location: z.looseObject({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    geohash: z.string().optional(),
  }),
  query: queryBlock.optional(),
});

// App-facing shapes.
export type QlooTag = { id: string; name: string; type?: string; affinity?: number };

export type QlooEntity = {
  id: string;
  name: string;
  subtype?: string;
  popularity?: number;
  affinity?: number;
  tags: QlooTag[];
  // Only the small facts we use (description, year, address and so on), not the whole property block.
  properties: Record<string, unknown>;
  // Places only.
  location?: { lat: number; lon: number };
  address?: string;
  neighborhood?: string;
};

export type QlooHeatPoint = {
  lat: number;
  lon: number;
  geohash?: string;
  affinity?: number;
  popularity?: number;
};

export type Parsed<T> = { items: T[]; warnings: string[] };

// Where Qloo puts the affinity score: query.affinity. Top results all sit between 0.99 and 1.0, so it cannot
// rank an area's favourites on its own; callers rank by position or rescale within the list.
function affinityOf(query: z.infer<typeof queryBlock> | undefined): number | undefined {
  return query?.affinity;
}

// How much a tag says about taste, by its type. Genres, themes and styles describe taste; keywords and
// character tags (hundreds per film, such as "Funeral procession") are mostly noise.
export function tagTypeWeight(type: string | undefined): number {
  if (!type) return 0.4;
  if (/:genre:/.test(type)) return 1;
  if (/:(theme|style|archetype|audience|interests|ambience|activity_type|neighborhood_characteristic|category|setting|visit_intent):/.test(type)) return 0.7;
  if (/:(keyword|character|plot):/.test(type)) return 0.25;
  return 0.4;
}

const MAX_TAGS_PER_ENTITY = 12;

function normaliseTag(t: z.infer<typeof tagRefSchema>): QlooTag | undefined {
  const id = t.id ?? t.tag_id;
  if (!id || !t.name) return undefined;
  return { id, name: t.name, type: t.type ?? t.subtype ?? t.types?.[0] };
}

// An entity can list over 250 tags. Keep the ones that say most about taste.
function selectTags(raw: Array<z.infer<typeof tagRefSchema>> | undefined): QlooTag[] {
  const tags: QlooTag[] = [];
  for (const t of raw ?? []) {
    const tag = normaliseTag(t);
    if (tag) tags.push(tag);
  }
  return tags
    .map((tag, index) => ({ tag, index }))
    .sort((a, b) => tagTypeWeight(b.tag.type) - tagTypeWeight(a.tag.type) || a.index - b.index)
    .slice(0, MAX_TAGS_PER_ENTITY)
    .map((x) => x.tag);
}

const KEPT_PROPERTIES = [
  "description",
  "short_descriptions",
  "release_year",
  "release_date",
  "address",
  "neighborhood",
  "business_rating",
  "price_level",
  "price_range",
  "primary_genre",
  "content_rating",
  "title_type",
] as const;

// Short text and numbers only: the full property block holds plot summaries and image lists.
function compactProperties(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_PROPERTIES) {
    const value = properties?.[key];
    if (typeof value === "number") kept[key] = value;
    else if (typeof value === "string") kept[key] = value.slice(0, 400);
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) kept[key] = value.slice(0, 3).map((v) => v.slice(0, 300));
  }
  return kept;
}

function toEntity(raw: z.infer<typeof entitySchema>): QlooEntity {
  const properties = compactProperties(raw.properties);
  const lat = raw.location?.lat;
  const lon = raw.location?.lon;
  const address = typeof raw.properties?.address === "string" ? raw.properties.address : raw.disambiguation;
  const neighborhood = typeof raw.properties?.neighborhood === "string" ? raw.properties.neighborhood : undefined;
  return {
    id: raw.entity_id,
    name: raw.name,
    subtype: raw.subtype ?? raw.types?.[0],
    popularity: raw.popularity,
    affinity: affinityOf(raw.query),
    tags: selectTags(raw.tags),
    properties,
    ...(lat !== undefined && lon !== undefined ? { location: { lat, lon } } : {}),
    ...(address ? { address } : {}),
    ...(neighborhood ? { neighborhood } : {}),
  };
}

function toTag(raw: z.infer<typeof tagSchema>): QlooTag | undefined {
  const tag = normaliseTag(raw);
  return tag ? { ...tag, affinity: affinityOf(raw.query) } : undefined;
}

function toHeatPoint(raw: z.infer<typeof heatmapPointSchema>): QlooHeatPoint | undefined {
  const { latitude, longitude, geohash } = raw.location;
  if (latitude === undefined || longitude === undefined) return undefined;
  return {
    lat: latitude,
    lon: longitude,
    geohash,
    affinity: affinityOf(raw.query),
    popularity: raw.query?.popularity,
  };
}

// Where a place is. Absent means unknown.
export function placeCoordinates(place: QlooEntity): { lat: number; lon: number } | null {
  return place.location ? { lat: place.location.lat, lon: place.location.lon } : null;
}

// Finds the result array: results[key] for insights, or results itself for /search.
function findList(data: unknown, key: string | null): { list: unknown[]; warning?: string } {
  const results = (data as { results?: unknown } | null)?.results;
  const list = key === null ? results : (results as Record<string, unknown> | undefined)?.[key];
  if (Array.isArray(list)) return { list };
  return { list: [], warning: `Qloo response had no "${key ?? "results"}" list.` };
}

function parseList<S, T>(
  data: unknown,
  key: string | null,
  schema: z.ZodType<S>,
  convert: (value: S) => T | undefined,
  label: string,
): Parsed<T> {
  const { list, warning } = findList(data, key);
  const warnings = warning ? [warning] : [];
  const items: T[] = [];
  let dropped = 0;
  for (const raw of list) {
    const parsed = schema.safeParse(raw);
    const value = parsed.success ? convert(parsed.data) : undefined;
    if (value === undefined) dropped += 1;
    else items.push(value);
  }
  if (dropped > 0) warnings.push(`Skipped ${dropped} ${label} with an unexpected shape.`);
  return { items, warnings };
}

export const parseSearchResults = (data: unknown) =>
  parseList(data, null, entitySchema, toEntity, "search results");

export const parseEntityResults = (data: unknown) =>
  parseList(data, "entities", entitySchema, toEntity, "entities");

export const parseTagResults = (data: unknown) =>
  parseList(data, "tags", tagSchema, toTag, "tags");

// The heatmap ignores `take` and returns thousands of points (3,150 at 8 km), so keep the strongest.
export function parseHeatmapResults(data: unknown, limit = 80): Parsed<QlooHeatPoint> {
  const parsed = parseList(data, "heatmap", heatmapPointSchema, toHeatPoint, "heatmap points");
  const strongest = [...parsed.items].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)).slice(0, limit);
  return { items: strongest, warnings: parsed.warnings };
}

// Number of results in any Qloo response, for the call log.
export function countResults(data: unknown): number | null {
  const results = (data as { results?: unknown } | null)?.results;
  if (Array.isArray(results)) return results.length;
  if (results && typeof results === "object") {
    for (const value of Object.values(results)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return null;
}
