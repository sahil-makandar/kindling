import { qlooGet, type QlooContext, type QlooGet, type QlooParams } from "./client";
import {
  parseEntityResults,
  parseHeatmapResults,
  parseSearchResults,
  parseTagResults,
  type Parsed,
  type QlooEntity,
  type QlooHeatPoint,
  type QlooTag,
} from "./schemas";

// Typed helpers over the Qloo REST endpoints (docs/QLOO_API.md section 3). Each one returns
// normalised items, any parse warnings (for the trace), and the id of the logged call.

export type Endpoints = ReturnType<typeof createEndpoints>;

// video_game is on Qloo's official list but the API answers 400 "not supported for filter.type" (live spike), so it is left out.
export type EntityDomain = "artist" | "movie" | "tv_show" | "book" | "podcast" | "place";

  // Radius is in metres (live spike). Resolution is coarse: 150 m and 1,500 m give identical results, and at 3 km two
  // different neighbourhoods give identical lists, so stay at or under about 2 km for anything local.
export type GeoArea = { lon: number; lat: number; radiusM: number };

// An area is a point with a radius, or, as the last resort when data is thin, a whole city by name.
// Neighbourhood names do not work as city queries (docs/QLOO_API.md section 4), so only use this with a city.
export type AreaSpec = GeoArea | { city: string };

export type EndpointResult<T> = Parsed<T> & {
  callId: string | null;
  cached: boolean;
  // What was asked. Qloo silently ignores parameters it does not understand, so when `empty` is true
  // the caller puts this in the trace to help find a bad parameter.
  endpoint: string;
  params: Record<string, string>;
  empty: boolean;
};

// WKT puts longitude first.
export function pointWkt(lon: number, lat: number): string {
  return `POINT(${lon} ${lat})`;
}

const entityType = (domain: EntityDomain) => `urn:entity:${domain}`;

function withArea(prefix: "signal" | "filter", area: AreaSpec | undefined): QlooParams {
  if (!area) return {};
  if ("city" in area) return { [`${prefix}.location.query`]: area.city };
  return {
    [`${prefix}.location`]: pointWkt(area.lon, area.lat),
    [`${prefix}.location.radius`]: Math.round(area.radiusM),
  };
}

export type InsightsEntitiesArgs = {
  domain: EntityDomain;
  signalArea?: AreaSpec;
  signalEntities?: string[];
  signalTags?: string[];
  filterArea?: AreaSpec;
  trending?: boolean;
  excludeEntities?: string[];
  // 0 to 1. Qloo's area favourites are dominated by the biggest names (popularity above 0.9). Capping popularity
  // surfaces the more distinctive picks.
  popularityMax?: number;
  take?: number;
};

export type ScoreListArgs = {
  domain: EntityDomain;
  entityIds: string[];
  signalArea?: AreaSpec;
  signalEntities?: string[];
};

export type InsightsTagsArgs = {
  signalArea?: AreaSpec;
  signalEntities?: string[];
  take?: number;
};

export function createEndpoints(get: QlooGet) {
  async function call<T>(
    path: string,
    params: QlooParams,
    ctx: QlooContext,
    parse: (data: unknown) => Parsed<T>,
  ): Promise<EndpointResult<T>> {
    const res = await get(path, params, ctx);
    const parsed = parse(res.data);
    return {
      ...parsed,
      callId: res.callId,
      cached: res.cached,
      endpoint: path,
      params: res.params,
      empty: parsed.items.length === 0,
    };
  }

  return {
    // Find places or media by name. Pass several types to search across them.
    searchEntities(
      args: { query: string; types: EntityDomain[]; take?: number },
      ctx: QlooContext,
    ): Promise<EndpointResult<QlooEntity>> {
      return call(
        "/search",
        { query: args.query, types: args.types.map(entityType).join(","), take: args.take ?? 8 },
        ctx,
        parseSearchResults,
      );
    },

    getEntities(ids: string[], ctx: QlooContext): Promise<EndpointResult<QlooEntity>> {
      return call("/entities", { entity_ids: ids.join(",") }, ctx, parseSearchResults);
    },

    // Turn a word like "jazz" into real Qloo tag ids.
    searchTags(query: string, ctx: QlooContext): Promise<EndpointResult<QlooTag>> {
      return call("/v2/tags", { "filter.query": query }, ctx, parseTagResults);
    },

    insightsEntities(args: InsightsEntitiesArgs, ctx: QlooContext): Promise<EndpointResult<QlooEntity>> {
      return call(
        "/v2/insights",
        {
          "filter.type": entityType(args.domain),
          ...withArea("signal", args.signalArea),
          ...withArea("filter", args.filterArea),
          "signal.interests.entities": args.signalEntities?.join(","),
          "signal.interests.tags": args.signalTags?.join(","),
          "filter.exclude.entities": args.excludeEntities?.join(","),
          "filter.popularity.max": args.popularityMax,
          "bias.trends": args.trending ? "high" : undefined,
          take: args.take ?? 15,
        },
        ctx,
        parseEntityResults,
      );
    },

    // Tags that describe the taste of an area or of a set of favourites.
    insightsTags(args: InsightsTagsArgs, ctx: QlooContext): Promise<EndpointResult<QlooTag>> {
      return call(
        "/v2/insights",
        {
          "filter.type": "urn:tag",
          ...withArea("signal", args.signalArea),
          "signal.interests.entities": args.signalEntities?.join(","),
          take: args.take ?? 25,
        },
        ctx,
        parseTagResults,
      );
    },

    // Where a taste concentrates on the map. Shape is UNVERIFIED until the spike.
    insightsHeatmap(
      args: { signalEntities: string[]; filterArea: GeoArea; limit?: number },
      ctx: QlooContext,
    ): Promise<EndpointResult<QlooHeatPoint>> {
      return call(
        "/v2/insights",
        {
          "filter.type": "urn:heatmap",
          "signal.interests.entities": args.signalEntities.join(","),
          ...withArea("filter", args.filterArea),
        },
        ctx,
        (data) => parseHeatmapResults(data, args.limit),
      );
    },

    // Score a given list instead of discovering. Entities Qloo does not rank are simply absent,
    // which callers treat as low affinity, not as an error.
    scoreList(args: ScoreListArgs, ctx: QlooContext): Promise<EndpointResult<QlooEntity>> {
      return call(
        "/v2/insights",
        {
          "filter.type": entityType(args.domain),
          "filter.results.entities": args.entityIds.join(","),
          ...withArea("signal", args.signalArea),
          "signal.interests.entities": args.signalEntities?.join(","),
        },
        ctx,
        parseEntityResults,
      );
    },
  };
}

// Bound to the shared client. Use these in agent code.
export const qloo = createEndpoints(qlooGet);
export const { searchEntities, getEntities, searchTags, insightsEntities, insightsTags, insightsHeatmap, scoreList } =
  qloo;
