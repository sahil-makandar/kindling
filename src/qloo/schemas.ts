import { z } from "zod";

// Response shapes follow docs/QLOO_API.md section 5, which is UNVERIFIED until the live spike (Q1).
// Everything is loose (unknown fields are kept) and optional, so a surprise in the real API becomes
// a warning in the trace, not a crash. Q2 adjusts this one file once real responses are recorded.

const queryBlock = z.looseObject({
  affinity: z.number().optional(),
  popularity: z.number().optional(),
});

const tagRefSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
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
});

export const tagSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
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

// App-facing shapes, so the rest of the code never touches raw Qloo field names.
export type QlooTag = { id: string; name: string; type?: string; affinity?: number };

export type QlooEntity = {
  id: string;
  name: string;
  subtype?: string;
  popularity?: number;
  affinity?: number;
  tags: QlooTag[];
  properties: Record<string, unknown>;
};

export type QlooHeatPoint = {
  lat: number;
  lon: number;
  geohash?: string;
  affinity?: number;
  popularity?: number;
};

export type Parsed<T> = { items: T[]; warnings: string[] };

// Where Qloo puts the affinity score (UNVERIFIED path, confirmed in Q1).
function affinityOf(query: z.infer<typeof queryBlock> | undefined): number | undefined {
  return query?.affinity;
}

function toEntity(raw: z.infer<typeof entitySchema>): QlooEntity {
  const tags: QlooTag[] = [];
  for (const t of raw.tags ?? []) {
    if (t.id && t.name) tags.push({ id: t.id, name: t.name, type: t.type });
  }
  return {
    id: raw.entity_id,
    name: raw.name,
    subtype: raw.subtype ?? raw.types?.[0],
    popularity: raw.popularity,
    affinity: affinityOf(raw.query),
    tags,
    properties: raw.properties ?? {},
  };
}

function toTag(raw: z.infer<typeof tagSchema>): QlooTag {
  return { id: raw.id, name: raw.name, type: raw.type, affinity: affinityOf(raw.query) };
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

// Where a place says it is (shape UNVERIFIED until Q1). Absent or odd shapes mean "unknown".
export function placeCoordinates(place: QlooEntity): { lat: number; lon: number } | null {
  const geocode = place.properties.geocode as { latitude?: unknown; longitude?: unknown } | undefined;
  if (typeof geocode?.latitude === "number" && typeof geocode.longitude === "number") {
    return { lat: geocode.latitude, lon: geocode.longitude };
  }
  return null;
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

export const parseHeatmapResults = (data: unknown) =>
  parseList(data, "heatmap", heatmapPointSchema, toHeatPoint, "heatmap points");

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
