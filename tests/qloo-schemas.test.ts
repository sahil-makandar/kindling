import { describe, expect, it } from "vitest";
import {
  countResults,
  entitySchema,
  parseEntityResults,
  parseHeatmapResults,
  parseSearchResults,
  parseTagResults,
} from "@/src/qloo/schemas";

describe("schema tolerance", () => {
  it("keeps unknown fields on entities", () => {
    const parsed = entitySchema.parse({ entity_id: "a", name: "A", surprise: { deep: 1 } });
    expect(parsed).toHaveProperty("surprise");
  });

  it("accepts an entity with only an id and a name", () => {
    const { items, warnings } = parseEntityResults({ results: { entities: [{ entity_id: "a", name: "A" }] } });
    expect(warnings).toEqual([]);
    expect(items).toEqual([{ id: "a", name: "A", subtype: undefined, popularity: undefined, affinity: undefined, tags: [], properties: {} }]);
  });

  it("reads affinity from query.affinity and tags from the tag list", () => {
    const { items } = parseEntityResults({
      results: {
        entities: [
          {
            entity_id: "a",
            name: "A",
            subtype: "urn:entity:movie",
            popularity: 0.9,
            query: { affinity: 0.77 },
            tags: [{ id: "t1", name: "Tag One", type: "genre" }, { id: "t2" }],
          },
        ],
      },
    });
    expect(items[0].affinity).toBe(0.77);
    expect(items[0].subtype).toBe("urn:entity:movie");
    expect(items[0].tags).toEqual([{ id: "t1", name: "Tag One", type: "genre" }]);
  });

  it("drops malformed items with a warning instead of throwing", () => {
    const { items, warnings } = parseEntityResults({
      results: { entities: [{ entity_id: "a", name: "A" }, { name: "no id" }, "nonsense", null] },
    });
    expect(items).toHaveLength(1);
    expect(warnings).toEqual(["Skipped 3 entities with an unexpected shape."]);
  });

  it("warns when the result list is missing, for any response shape", () => {
    expect(parseEntityResults({ success: true }).warnings[0]).toMatch(/no "entities" list/);
    expect(parseTagResults(null).warnings[0]).toMatch(/no "tags" list/);
    expect(parseSearchResults("oops").warnings[0]).toMatch(/no "results" list/);
    expect(parseEntityResults(undefined).items).toEqual([]);
  });

  it("reads search results from a plain results array", () => {
    const { items } = parseSearchResults({
      results: [{ entity_id: "p1", name: "Place", types: ["urn:entity:place"] }],
    });
    expect(items[0].subtype).toBe("urn:entity:place");
  });

  it("parses tags and skips tags without a name", () => {
    const { items, warnings } = parseTagResults({
      results: { tags: [{ id: "t", name: "Lo-fi", query: { affinity: 0.8 } }, { id: "x" }] },
    });
    expect(items).toEqual([{ id: "t", name: "Lo-fi", type: undefined, affinity: 0.8 }]);
    expect(warnings).toHaveLength(1);
  });

  it("parses heatmap points and skips ones without coordinates", () => {
    const { items, warnings } = parseHeatmapResults({
      results: {
        heatmap: [
          { location: { latitude: 40.7, longitude: -73.9, geohash: "dr5" }, query: { affinity: 0.8, popularity: 0.4 } },
          { location: { geohash: "nowhere" } },
        ],
      },
    });
    expect(items).toEqual([{ lat: 40.7, lon: -73.9, geohash: "dr5", affinity: 0.8, popularity: 0.4 }]);
    expect(warnings).toHaveLength(1);
  });
});

describe("countResults", () => {
  it("counts a results array, a keyed list, and nothing", () => {
    expect(countResults({ results: [1, 2, 3] })).toBe(3);
    expect(countResults({ results: { entities: [1, 2] } })).toBe(2);
    expect(countResults({ results: {} })).toBeNull();
    expect(countResults(null)).toBeNull();
  });
});
