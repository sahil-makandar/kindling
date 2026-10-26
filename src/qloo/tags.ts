import { QlooError } from "./client";
import type { Endpoints, GeoArea } from "./endpoints";
import { placeCoordinates, type QlooEntity, type QlooHeatPoint, type QlooTag } from "./schemas";
import type { QlooContext } from "./client";

// Qloo's official filter.type list has no urn:tag or urn:heatmap (docs/QLOO_API.md section 0). We try them,
// because they may work, but everything that needs them has a fallback built from supported data: the tags
// carried by entities, and the coordinates of places. A 403 means unsupported; we then stop asking.

export const TAG_TYPE = "urn:tag";
export const HEATMAP_TYPE = "urn:heatmap";

const unsupported = new Set<string>();
export const markUnsupported = (type: string) => void unsupported.add(type);
export const isUnsupported = (type: string) => unsupported.has(type);
export const resetUnsupported = () => unsupported.clear();

export type TagSource = "qloo_tags" | "entity_tags";

export type TagResult = {
  tags: QlooTag[];
  source: TagSource;
  // Set when the fallback was used, in plain words for the trace.
  fallbackReason?: string;
  warnings: string[];
  callId: string | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Builds a weighted tag list from the tags the entities themselves carry.
// "affinity" weights each entity by its affinity (an area's top results); "count" weights each equally,
// so a tag every entity has scores 1 (a guest's favourites).
export function tagsFromEntities(entities: QlooEntity[], mode: "affinity" | "count", take = 30): QlooTag[] {
  const scores = new Map<string, { tag: QlooTag; score: number }>();
  for (const entity of entities) {
    const weight = mode === "affinity" ? (entity.affinity ?? 0.5) : 1;
    // An entity counts once per tag even if it lists the tag twice.
    for (const tag of new Map(entity.tags.map((t) => [t.id, t])).values()) {
      const current = scores.get(tag.id);
      if (current) current.score += weight;
      else scores.set(tag.id, { tag, score: weight });
    }
  }
  if (scores.size === 0) return [];
  const top = Math.max(...[...scores.values()].map((s) => s.score));
  const divisor = mode === "affinity" ? top : entities.length;
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.tag.name.localeCompare(b.tag.name))
    .slice(0, take)
    .map(({ tag, score }) => ({ id: tag.id, name: tag.name, type: tag.type, affinity: round2(score / divisor) }));
}

type TagApi = Pick<Endpoints, "insightsTags" | "getEntities">;

// Runs a call that depends on an unlisted filter type. Returns what it found, or the plain-words reason
// to fall back. Only Qloo errors are caught; anything else is a real bug and is rethrown.
async function tryUnlisted<T extends { empty: boolean }>(
  type: string,
  attempt: () => Promise<T>,
  what: string,
): Promise<{ ok: T } | { reason: string }> {
  if (isUnsupported(type)) return { reason: `Qloo does not offer ${what} for this key.` };
  try {
    const result = await attempt();
    if (!result.empty) return { ok: result };
    return { reason: `Qloo returned no ${what}.` };
  } catch (error) {
    if (!(error instanceof QlooError)) throw error;
    if (error.status === 403) markUnsupported(type);
    return { reason: `Qloo could not give us ${what} (${error.message})` };
  }
}

// The area's tag vocabulary for the Scout. The fallback uses the entities already fetched for the area.
export async function areaTags(
  api: TagApi,
  args: { area: GeoArea; areaEntities: QlooEntity[]; take?: number },
  ctx: QlooContext,
): Promise<TagResult> {
  const take = args.take ?? 30;
  const primary = await tryUnlisted(TAG_TYPE, () => api.insightsTags({ signalArea: args.area, take }, ctx), "area tags");
  if ("ok" in primary) {
    return { tags: primary.ok.items, source: "qloo_tags", warnings: primary.ok.warnings, callId: primary.ok.callId };
  }
  return {
    tags: tagsFromEntities(args.areaEntities, "affinity", take),
    source: "entity_tags",
    fallbackReason: `${primary.reason} Reading the tags carried by the area's top results instead.`,
    warnings: [],
    callId: null,
  };
}

// A taste vector for one guest (their favourites), or for a whole room (everyone's favourites, for the Coach).
// The fallback uses the favourites' own tags: pass them in when already known (they came with the search
// results at check-in), otherwise they are fetched from /entities.
export async function tagsForFavourites(
  api: TagApi,
  args: { favouriteIds: string[]; knownEntities?: QlooEntity[]; take?: number },
  ctx: QlooContext,
): Promise<TagResult> {
  const take = args.take ?? 25;
  const primary = await tryUnlisted(
    TAG_TYPE,
    () => api.insightsTags({ signalEntities: args.favouriteIds, take }, ctx),
    "a taste profile",
  );
  if ("ok" in primary) {
    return { tags: primary.ok.items, source: "qloo_tags", warnings: primary.ok.warnings, callId: primary.ok.callId };
  }

  let entities = args.knownEntities;
  let callId: string | null = null;
  const warnings: string[] = [];
  if (!entities || entities.length === 0) {
    const fetched = await api.getEntities(args.favouriteIds, ctx);
    entities = fetched.items;
    callId = fetched.callId;
    warnings.push(...fetched.warnings);
  }
  return {
    tags: tagsFromEntities(entities, "count", take),
    source: "entity_tags",
    fallbackReason: `${primary.reason} Using the favourites' own tags instead.`,
    warnings,
    callId,
  };
}

// Heat points from nearby places that carry coordinates and an affinity. Used when urn:heatmap is not available.
export function heatFromPlaces(places: QlooEntity[]): QlooHeatPoint[] {
  const points: QlooHeatPoint[] = [];
  for (const place of places) {
    const coords = placeCoordinates(place);
    if (coords) {
      points.push({ lat: coords.lat, lon: coords.lon, affinity: place.affinity, popularity: place.popularity });
    }
  }
  return points;
}

export type HeatResult = {
  points: QlooHeatPoint[];
  source: "qloo_heatmap" | "nearby_places";
  fallbackReason?: string;
  callId: string | null;
};

export async function areaHeat(
  api: Pick<Endpoints, "insightsHeatmap">,
  args: { anchorId: string; area: GeoArea; nearbyPlaces: QlooEntity[] },
  ctx: QlooContext,
): Promise<HeatResult> {
  const primary = await tryUnlisted(
    HEATMAP_TYPE,
    () => api.insightsHeatmap({ signalEntities: [args.anchorId], filterArea: args.area }, ctx),
    "a heatmap",
  );
  if ("ok" in primary) {
    return { points: primary.ok.items, source: "qloo_heatmap", callId: primary.ok.callId };
  }
  return {
    points: heatFromPlaces(args.nearbyPlaces),
    source: "nearby_places",
    fallbackReason: `${primary.reason} Showing nearby places instead.`,
    callId: null,
  };
}
