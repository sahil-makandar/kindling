import { describe, expect, it, vi } from "vitest";
import type { QlooGet } from "@/src/qloo/client";
import { createEndpoints } from "@/src/qloo/endpoints";

function spy() {
  const get = vi.fn<QlooGet>(async () => ({ data: { results: {} }, callId: "c1", status: 200, ms: 1, cached: false }));
  return { get, api: createEndpoints(get) };
}

const ctx = { purpose: "scout.area_entities" as const };
const area = { lon: -73.9571, lat: 40.7081, radiusM: 1500.4 };

describe("endpoint parameters", () => {
  it("builds an area scan with longitude first and a whole-number radius", async () => {
    const { get, api } = spy();
    await api.insightsEntities({ domain: "movie", signalArea: area, take: 12 }, ctx);
    expect(get).toHaveBeenCalledWith(
      "/v2/insights",
      expect.objectContaining({
        "filter.type": "urn:entity:movie",
        "signal.location": "POINT(-73.9571 40.7081)",
        "signal.location.radius": 1500,
        take: 12,
      }),
      ctx,
    );
  });

  it("leaves out options that were not asked for", async () => {
    const { get, api } = spy();
    await api.insightsEntities({ domain: "book", signalArea: area }, ctx);
    const params = get.mock.calls[0][1];
    expect(params["bias.trends"]).toBeUndefined();
    expect(params["signal.interests.entities"]).toBeUndefined();
    expect(params["filter.location"]).toBeUndefined();
  });

  it("asks for rising items with bias.trends=high", async () => {
    const { get, api } = spy();
    await api.insightsEntities({ domain: "artist", signalArea: area, trending: true }, ctx);
    expect(get.mock.calls[0][1]["bias.trends"]).toBe("high");
  });

  it("uses filter.location for nearby places", async () => {
    const { get, api } = spy();
    await api.insightsEntities({ domain: "place", signalArea: area, filterArea: area }, ctx);
    const params = get.mock.calls[0][1];
    expect(params["filter.type"]).toBe("urn:entity:place");
    expect(params["filter.location"]).toBe("POINT(-73.9571 40.7081)");
    expect(params["filter.location.radius"]).toBe(1500);
  });

  it("scores a list with filter.results.entities", async () => {
    const { get, api } = spy();
    await api.scoreList({ domain: "movie", entityIds: ["a", "b"], signalEntities: ["anchor"] }, ctx);
    expect(get.mock.calls[0][1]).toMatchObject({
      "filter.type": "urn:entity:movie",
      "filter.results.entities": "a,b",
      "signal.interests.entities": "anchor",
    });
  });

  it("asks for tags from favourites with a default of 25", async () => {
    const { get, api } = spy();
    await api.insightsTags({ signalEntities: ["x", "y", "z"] }, ctx);
    expect(get.mock.calls[0][1]).toMatchObject({
      "filter.type": "urn:tag",
      "signal.interests.entities": "x,y,z",
      take: 25,
    });
  });

  it("joins several types for a search", async () => {
    const { get, api } = spy();
    await api.searchEntities({ query: "Spirited", types: ["movie", "tv_show"] }, ctx);
    expect(get).toHaveBeenCalledWith(
      "/search",
      { query: "Spirited", types: "urn:entity:movie,urn:entity:tv_show", take: 8 },
      ctx,
    );
  });

  it("builds a heatmap request", async () => {
    const { get, api } = spy();
    await api.insightsHeatmap({ signalEntities: ["a"], filterArea: area }, ctx);
    expect(get.mock.calls[0][1]).toMatchObject({
      "filter.type": "urn:heatmap",
      "signal.interests.entities": "a",
      "filter.location": "POINT(-73.9571 40.7081)",
    });
  });

  it("passes back the call id and a warning when the response has no list", async () => {
    const { api } = spy();
    const result = await api.searchTags("jazz", ctx);
    expect(result.callId).toBe("c1");
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toMatch(/no "tags" list/);
  });
});
