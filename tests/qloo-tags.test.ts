import { beforeEach, describe, expect, it, vi } from "vitest";
import { traceEmptyResult } from "@/src/agent/qlooTrace";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createTracer } from "@/src/agent/trace";
import { QlooError, createQlooClient } from "@/src/qloo/client";
import { createEndpoints, type Endpoints, type EndpointResult } from "@/src/qloo/endpoints";
import type { QlooEntity, QlooTag } from "@/src/qloo/schemas";
import { createMemoryStore } from "@/src/qloo/store";
import {
  areaHeat,
  areaTags,
  heatFromPlaces,
  isUnsupported,
  resetUnsupported,
  tagsForFavourites,
  tagsFromEntities,
} from "@/src/qloo/tags";

const tag = (id: string): QlooTag => ({ id, name: id.toUpperCase() });
const entity = (id: string, tags: string[], affinity?: number, geo?: [number, number]): QlooEntity => ({
  id,
  name: id,
  tags: tags.map(tag),
  affinity,
  popularity: 0.5,
  properties: geo ? { geocode: { latitude: geo[0], longitude: geo[1] } } : {},
});

const area = { lon: -73.95, lat: 40.7, radiusM: 1500 };
const ctx = { purpose: "scout.area_tags" as const };

function result<T>(items: T[], extra: Partial<EndpointResult<T>> = {}): EndpointResult<T> {
  return { items, warnings: [], callId: "c1", cached: false, endpoint: "/v2/insights", params: {}, empty: items.length === 0, ...extra };
}

beforeEach(() => {
  resetUnsupported();
});

describe("tagsFromEntities", () => {
  it("weights an area's tags by the affinity of the entities that carry them", () => {
    const tags = tagsFromEntities(
      [entity("a", ["x", "y"], 0.9), entity("b", ["x"], 0.7), entity("c", ["z"], 0.1)],
      "affinity",
    );
    expect(tags.map((t) => [t.id, t.affinity])).toEqual([
      ["x", 1],
      ["y", 0.56],
      ["z", 0.06],
    ]);
  });

  it("scores a guest's tags by the share of favourites that have them", () => {
    const tags = tagsFromEntities([entity("a", ["jp", "anime"]), entity("b", ["jp"]), entity("c", ["jp", "food"])], "count");
    expect(tags[0]).toMatchObject({ id: "jp", affinity: 1 });
    expect(tags.find((t) => t.id === "anime")?.affinity).toBeCloseTo(0.33, 2);
  });

  it("counts a tag once per entity even if it is listed twice", () => {
    const tags = tagsFromEntities([entity("a", ["x", "x"])], "count");
    expect(tags).toEqual([{ id: "x", name: "X", type: undefined, affinity: 1 }]);
  });

  it("treats a missing affinity as 0.5 and orders ties by name", () => {
    const tags = tagsFromEntities([entity("a", ["b", "a"])], "affinity");
    expect(tags.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("limits the number of tags and handles no tags at all", () => {
    expect(tagsFromEntities([entity("a", ["1", "2", "3", "4"])], "count", 2)).toHaveLength(2);
    expect(tagsFromEntities([entity("a", [])], "count")).toEqual([]);
    expect(tagsFromEntities([], "affinity")).toEqual([]);
  });
});

describe("areaTags", () => {
  it("uses Qloo's tag view when it works", async () => {
    const api = { insightsTags: vi.fn(async () => result([tag("q1")])), getEntities: vi.fn() };
    const out = await areaTags(api as unknown as Endpoints, { area, areaEntities: [entity("a", ["x"], 0.9)] }, ctx);
    expect(out).toMatchObject({ source: "qloo_tags", callId: "c1" });
    expect(out.tags.map((t) => t.id)).toEqual(["q1"]);
    expect(out.fallbackReason).toBeUndefined();
  });

  it("falls back to the area's entity tags on a 403 and stops asking after that", async () => {
    const insightsTags = vi.fn(async () => {
      throw new QlooError("Qloo does not allow this kind of request with our key (status 403).", 403);
    });
    const api = { insightsTags, getEntities: vi.fn() } as unknown as Endpoints;
    const entities = [entity("a", ["x", "y"], 0.9), entity("b", ["x"], 0.6)];

    const first = await areaTags(api, { area, areaEntities: entities }, ctx);
    expect(first.source).toBe("entity_tags");
    expect(first.tags[0].id).toBe("x");
    expect(first.fallbackReason).toMatch(/Reading the tags carried by the area's top results instead/);
    expect(isUnsupported("urn:tag")).toBe(true);

    const second = await areaTags(api, { area, areaEntities: entities }, ctx);
    expect(second.source).toBe("entity_tags");
    expect(insightsTags).toHaveBeenCalledTimes(1);
  });

  it("falls back when Qloo answers with no tags, without marking the type unsupported", async () => {
    const insightsTags = vi.fn(async () => result<QlooTag>([]));
    const out = await areaTags({ insightsTags } as unknown as Endpoints, { area, areaEntities: [entity("a", ["x"])] }, ctx);
    expect(out.source).toBe("entity_tags");
    expect(isUnsupported("urn:tag")).toBe(false);
    await areaTags({ insightsTags } as unknown as Endpoints, { area, areaEntities: [entity("a", ["x"])] }, ctx);
    expect(insightsTags).toHaveBeenCalledTimes(2);
  });

  it("falls back on other Qloo failures such as a timeout, without marking unsupported", async () => {
    const insightsTags = vi.fn(async () => {
      throw new QlooError("Qloo took too long to answer.", 0);
    });
    const out = await areaTags({ insightsTags } as unknown as Endpoints, { area, areaEntities: [entity("a", ["x"])] }, ctx);
    expect(out.source).toBe("entity_tags");
    expect(isUnsupported("urn:tag")).toBe(false);
  });

  it("does not hide real bugs", async () => {
    const insightsTags = vi.fn(async () => {
      throw new TypeError("boom");
    });
    await expect(
      areaTags({ insightsTags } as unknown as Endpoints, { area, areaEntities: [] }, ctx),
    ).rejects.toThrow("boom");
  });
});

describe("tagsForFavourites", () => {
  const forbidden = () =>
    vi.fn(async () => {
      throw new QlooError("Qloo does not allow this kind of request with our key (status 403).", 403);
    });

  it("uses Qloo's taste profile when it works", async () => {
    const insightsTags = vi.fn(async () => result([tag("q1"), tag("q2")]));
    const out = await tagsForFavourites({ insightsTags, getEntities: vi.fn() } as unknown as Endpoints, { favouriteIds: ["a", "b"] }, ctx);
    expect(out.source).toBe("qloo_tags");
    expect(insightsTags).toHaveBeenCalledWith({ signalEntities: ["a", "b"], take: 25 }, ctx);
  });

  it("uses the favourites' tags already in hand, with no extra Qloo call", async () => {
    const getEntities = vi.fn();
    const out = await tagsForFavourites(
      { insightsTags: forbidden(), getEntities } as unknown as Endpoints,
      { favouriteIds: ["a", "b"], knownEntities: [entity("a", ["jp", "anime"]), entity("b", ["jp"])] },
      { purpose: "checkin.tags" },
    );
    expect(out.source).toBe("entity_tags");
    expect(out.tags[0]).toMatchObject({ id: "jp", affinity: 1 });
    expect(out.callId).toBeNull();
    expect(getEntities).not.toHaveBeenCalled();
    expect(out.fallbackReason).toMatch(/favourites' own tags/);
  });

  it("fetches the favourites from /entities when their tags are not known", async () => {
    const getEntities = vi.fn(async () => result([entity("a", ["jp"]), entity("b", ["jp", "food"])], { endpoint: "/entities", callId: "e1" }));
    const out = await tagsForFavourites(
      { insightsTags: forbidden(), getEntities } as unknown as Endpoints,
      { favouriteIds: ["a", "b"] },
      { purpose: "checkin.tags" },
    );
    expect(getEntities).toHaveBeenCalledWith(["a", "b"], { purpose: "checkin.tags" });
    expect(out).toMatchObject({ source: "entity_tags", callId: "e1" });
    expect(out.tags[0].id).toBe("jp");
  });

  it("gives guests with overlapping favourites overlapping vectors with no unlisted type needed", async () => {
    const insightsTags = forbidden();
    const getEntities = vi.fn();
    const api = { insightsTags, getEntities } as unknown as Endpoints;
    const spirited = entity("spirited", ["animation", "japanese"]);
    const totoro = entity("totoro", ["animation", "japanese"]);
    const bear = entity("bear", ["food", "drama"]);
    const a = await tagsForFavourites(api, { favouriteIds: ["spirited"], knownEntities: [spirited] }, ctx);
    const b = await tagsForFavourites(api, { favouriteIds: ["totoro"], knownEntities: [totoro] }, ctx);
    const c = await tagsForFavourites(api, { favouriteIds: ["bear"], knownEntities: [bear] }, ctx);
    const shared = (x: typeof a, y: typeof a) => x.tags.filter((t) => y.tags.some((u) => u.id === t.id)).length;
    expect(shared(a, b)).toBe(2);
    expect(shared(a, c)).toBe(0);
  });
});

describe("heat", () => {
  it("builds points from places that have coordinates", () => {
    const points = heatFromPlaces([
      entity("p1", [], 0.9, [40.7, -73.9]),
      entity("p2", [], 0.5),
      entity("p3", [], 0.7, [40.71, -73.95]),
    ]);
    expect(points).toEqual([
      { lat: 40.7, lon: -73.9, affinity: 0.9, popularity: 0.5 },
      { lat: 40.71, lon: -73.95, affinity: 0.7, popularity: 0.5 },
    ]);
  });

  it("uses the heatmap when it works", async () => {
    const insightsHeatmap = vi.fn(async () => result([{ lat: 1, lon: 2, affinity: 0.8 }], { callId: "h1" }));
    const out = await areaHeat({ insightsHeatmap } as unknown as Endpoints, { anchorId: "a", area, nearbyPlaces: [] }, { purpose: "verify.heatmap" });
    expect(out).toMatchObject({ source: "qloo_heatmap", callId: "h1" });
  });

  it("falls back to nearby places on a 403", async () => {
    const insightsHeatmap = vi.fn(async () => {
      throw new QlooError("Qloo does not allow this kind of request with our key (status 403).", 403);
    });
    const api = { insightsHeatmap } as unknown as Endpoints;
    const places = [entity("p1", [], 0.9, [40.7, -73.9])];
    const out = await areaHeat(api, { anchorId: "a", area, nearbyPlaces: places }, { purpose: "verify.heatmap" });
    expect(out.source).toBe("nearby_places");
    expect(out.points).toHaveLength(1);
    expect(out.fallbackReason).toMatch(/Showing nearby places instead/);
    await areaHeat(api, { anchorId: "a", area, nearbyPlaces: places }, { purpose: "verify.heatmap" });
    expect(insightsHeatmap).toHaveBeenCalledTimes(1);
  });
});

describe("with the offline fixtures", () => {
  it("takes the primary path when the fixtures support tags", async () => {
    const store = createMemoryStore();
    const api = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
    const out = await tagsForFavourites(api, { favouriteIds: ["fx_spirited_away", "fx_nujabes"] }, { purpose: "checkin.tags" });
    expect(out.source).toBe("qloo_tags");
    expect(out.tags.length).toBeGreaterThan(0);
  });
});

describe("traceEmptyResult", () => {
  it("writes the endpoint and every parameter into the trace as a warning", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    await traceEmptyResult(createTracer(repo, run.id, "scout"), "film in a 1.5 km radius", {
      endpoint: "/v2/insights",
      params: { "filter.type": "urn:entity:movie", "signal.location": "POINT(-73.95 40.7)", take: "15" },
    });
    const [line] = repo.traces;
    expect(line).toMatchObject({ stage: "scout", level: "warn" });
    expect(line.message).toContain("Qloo returned nothing for film in a 1.5 km radius.");
    expect(line.message).toContain("Sent /v2/insights with filter.type=urn:entity:movie, signal.location=POINT(-73.95 40.7), take=15.");
    expect(line.data).toEqual({
      endpoint: "/v2/insights",
      params: { "filter.type": "urn:entity:movie", "signal.location": "POINT(-73.95 40.7)", take: "15" },
    });
  });
});
