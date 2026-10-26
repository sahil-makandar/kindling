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

export type EntityDomain = "artist" | "movie" | "tv_show" | "book" | "podcast" | "video_game" | "place";

// Radius unit is assumed to be metres until the live spike confirms it (docs/QLOO_API.md section 7, question 1).
export type GeoArea = { lon: number; lat: number; radiusM: number };

export type EndpointResult<T> = Parsed<T> & { callId: string | null; cached: boolean };

// WKT puts longitude first.
export function pointWkt(lon: number, lat: number): string {
  return `POINT(${lon} ${lat})`;
}

const entityType = (domain: EntityDomain) => `urn:entity:${domain}`;

function withArea(prefix: "signal" | "filter", area: GeoArea | undefined): QlooParams {
  if (!area) return {};
  return {
    [`${prefix}.location`]: pointWkt(area.lon, area.lat),
    [`${prefix}.location.radius`]: Math.round(area.radiusM),
  };
}

export type InsightsEntitiesArgs = {
  domain: EntityDomain;
  signalArea?: GeoArea;
  signalEntities?: string[];
  signalTags?: string[];
  filterArea?: GeoArea;
  trending?: boolean;
  excludeEntities?: string[];
  take?: number;
};

export type ScoreListArgs = {
  domain: EntityDomain;
  entityIds: string[];
  signalArea?: GeoArea;
  signalEntities?: string[];
};

export type InsightsTagsArgs = {
  signalArea?: GeoArea;
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
    return { ...parse(res.data), callId: res.callId, cached: res.cached };
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
      args: { signalEntities: string[]; filterArea: GeoArea },
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
        parseHeatmapResults,
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
