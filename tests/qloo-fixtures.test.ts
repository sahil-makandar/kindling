import { describe, expect, it } from "vitest";
import catalogueJson from "@/fixtures/sample/catalogue.json";
import locationsJson from "@/fixtures/sample/locations.json";
import { createQlooClient } from "@/src/qloo/client";
import { createEndpoints, pointWkt, type EntityDomain, type GeoArea } from "@/src/qloo/endpoints";
import { FIXTURE_LOCATIONS } from "@/src/qloo/fixtures";
import { createMemoryStore } from "@/src/qloo/store";

// The JSON files hold compact tuples, so give them a plain shape for the checks below.
const catalogue = catalogueJson as unknown as {
  tags: Record<string, unknown>;
  entities: Record<string, Array<[id: string, name: string, popularity: number, tags: string[]]>>;
  places: Array<[id: string]>;
};
const locations = locationsJson as unknown as {
  locations: Record<
    string,
    { entities: Record<string, Array<[string, number]>>; places: Array<[string, number]>; tags: Array<[string, number]> }
  >;
};

function fixtureEndpoints() {
  const store = createMemoryStore();
  const client = createQlooClient({ mode: "fixtures", baseUrl: "https://qloo.test", store });
  return { api: createEndpoints(client.get), store };
}

const ctx = { purpose: "scout.area_entities" as const };
const DOMAINS: EntityDomain[] = ["artist", "movie", "tv_show", "book", "podcast"];
const area = (key: string, radiusM: number): GeoArea => {
  const loc = FIXTURE_LOCATIONS.find((l) => l.key === key);
  if (!loc) throw new Error(`no fixture location ${key}`);
  return { lon: loc.lon, lat: loc.lat, radiusM };
};

describe("fixture data integrity", () => {
  it("only refers to entities, places and tags that exist in the catalogue", () => {
    const entityIds = new Set(Object.values(catalogue.entities).flat().map((e) => e[0]));
    const placeIds = new Set(catalogue.places.map((p) => p[0]));
    const tagIds = new Set(Object.keys(catalogue.tags));
    for (const [key, loc] of Object.entries(locations.locations)) {
      for (const rows of Object.values(loc.entities)) {
        for (const [id] of rows) expect(entityIds.has(id), `${key}: ${id}`).toBe(true);
      }
      for (const [id] of loc.places) expect(placeIds.has(id), `${key}: ${id}`).toBe(true);
      for (const [id] of loc.tags) expect(tagIds.has(id), `${key}: ${id}`).toBe(true);
    }
    for (const e of Object.values(catalogue.entities).flat()) {
      for (const t of e[3]) expect(tagIds.has(t), `${e[0]}: ${t}`).toBe(true);
    }
  });

  it("marks every id as sample data", () => {
    const { api } = fixtureEndpoints();
    return api.insightsEntities({ domain: "movie", signalArea: area("soho", 3000) }, ctx).then((r) => {
      for (const item of r.items) expect(item.id.startsWith("fx_")).toBe(true);
    });
  });
});

describe("area scans (fixtures)", () => {
  it.each(FIXTURE_LOCATIONS.map((l) => l.key))("%s returns every domain, tags and places at 3 km", async (key) => {
    const { api } = fixtureEndpoints();
    for (const domain of DOMAINS) {
      const { items, warnings } = await api.insightsEntities({ domain, signalArea: area(key, 3000) }, ctx);
      expect(items.length, `${key} ${domain}`).toBeGreaterThanOrEqual(5);
      expect(items[0].affinity).toBeGreaterThan(0.5);
      expect(items[0].tags.length).toBeGreaterThan(0);
      expect(warnings).toEqual([]);
    }
    const tags = await api.insightsTags({ signalArea: area(key, 3000) }, ctx);
    expect(tags.items.length).toBeGreaterThanOrEqual(5);
    const places = await api.insightsEntities({ domain: "place", signalArea: area(key, 3000), filterArea: area(key, 3000) }, ctx);
    expect(places.items.length).toBeGreaterThanOrEqual(4);
  });

  it("gives different neighbourhoods different tastes", async () => {
    const { api } = fixtureEndpoints();
    const soho = await api.insightsEntities({ domain: "movie", signalArea: area("soho", 1500) }, ctx);
    const wburg = await api.insightsEntities({ domain: "movie", signalArea: area("williamsburg", 1500) }, ctx);
    expect(soho.items[0].name).toBe("In the Mood for Love");
    expect(wburg.items[0].name).toBe("Spirited Away");
  });

  it("is thin at small radii in Logan Square and fills in when widened", async () => {
    const { api } = fixtureEndpoints();
    const small = await api.insightsEntities({ domain: "artist", signalArea: area("logan_square", 500) }, ctx);
    const wide = await api.insightsEntities({ domain: "artist", signalArea: area("logan_square", 1000) }, ctx);
    expect(small.items.length).toBeLessThan(5);
    expect(wide.items.length).toBeGreaterThanOrEqual(5);
    const smallTags = await api.insightsTags({ signalArea: area("logan_square", 500) }, ctx);
    expect(smallTags.items.length).toBeLessThanOrEqual(5);
  });

  it("resolves a city name to the matching location", async () => {
    const store = createMemoryStore();
    const client = createQlooClient({ mode: "fixtures", baseUrl: "x", store });
    const res = await client.get(
      "/v2/insights",
      { "filter.type": "urn:entity:tv_show", "signal.location.query": "Chicago" },
      ctx,
    );
    const first = (res.data as { results: { entities: Array<{ name: string }> } }).results.entities[0];
    expect(first.name).toBe("The Bear");
  });

  it("returns trending results in a different order from plain results", async () => {
    const { api } = fixtureEndpoints();
    const plain = await api.insightsEntities({ domain: "artist", signalArea: area("soho", 3000) }, ctx);
    const trending = await api.insightsEntities({ domain: "artist", signalArea: area("soho", 3000), trending: true }, ctx);
    expect(trending.items.map((i) => i.id)).not.toEqual(plain.items.map((i) => i.id));
    expect(new Set(trending.items.map((i) => i.id))).toEqual(new Set(plain.items.map((i) => i.id)));
  });

  it("is deterministic", async () => {
    const { api } = fixtureEndpoints();
    const a = await api.insightsEntities({ domain: "book", signalArea: area("east_austin", 3000), trending: true }, ctx);
    const b = await api.insightsEntities({ domain: "book", signalArea: area("east_austin", 3000), trending: true }, ctx);
    expect(a.items).toEqual(b.items);
  });

  it("returns a 5 by 5 heatmap around the location", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.insightsHeatmap(
      { signalEntities: ["fx_spirited_away"], filterArea: area("williamsburg", 8000) },
      ctx,
    );
    expect(items).toHaveLength(25);
    expect(items.every((p) => p.affinity !== undefined && p.affinity >= 0 && p.affinity <= 1)).toBe(true);
  });
});

describe("venue lookup (fixtures)", () => {
  it("finds the venue and lists look-alikes after it", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.searchEntities({ query: "The Lantern Room Brooklyn", types: ["place"] }, ctx);
    expect(items[0].name).toBe("The Lantern Room");
    expect(items.map((i) => i.name)).toContain("Lantern Records");
    expect(items[0].properties).toHaveProperty("address");
  });

  it("returns nothing for a venue Qloo does not know", async () => {
    const { api } = fixtureEndpoints();
    const { items, warnings } = await api.searchEntities({ query: "Zzyzx Qwerty Parlour", types: ["place"] }, ctx);
    expect(items).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("finds media by name across types for check-in autocomplete", async () => {
    const { api } = fixtureEndpoints();
    const movies = await api.searchEntities({ query: "spirited", types: ["movie"] }, ctx);
    expect(movies.items.map((i) => i.name)).toEqual(["Spirited Away"]);
    const mixed = await api.searchEntities({ query: "the bear", types: ["movie", "tv_show", "book"] }, ctx);
    expect(mixed.items[0].name).toBe("The Bear");
    const wrongType = await api.searchEntities({ query: "spirited", types: ["book"] }, ctx);
    expect(wrongType.items).toEqual([]);
  });

  it("gets entities by id", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.getEntities(["fx_circe", "fx_missing"], ctx);
    expect(items.map((i) => i.name)).toEqual(["Circe"]);
  });
});

describe("verification calls (fixtures)", () => {
  it("scores companions by how much they share with the anchor, and omits the unrelated", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.scoreList(
      { domain: "movie", entityIds: ["fx_my_neighbor_totoro", "fx_parasite"], signalEntities: ["fx_spirited_away"] },
      { purpose: "verify.coherence" },
    );
    expect(items.map((i) => i.id)).toEqual(["fx_my_neighbor_totoro"]);
    // Totoro shares 3 of its 4 tags with Spirited Away.
    expect(items[0].affinity).toBeCloseTo(0.8, 2);
  });

  it("scores local strength from the area ranking and omits entities the area does not rank", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.scoreList(
      { domain: "artist", entityIds: ["fx_miki_matsubara", "fx_sade"], signalArea: area("williamsburg", 1500) },
      { purpose: "verify.local_strength" },
    );
    expect(items.find((i) => i.id === "fx_miki_matsubara")?.affinity).toBe(0.94);
    expect(items.find((i) => i.id === "fx_sade")?.affinity).toBe(0.76);
    const soho = await api.scoreList(
      { domain: "artist", entityIds: ["fx_miki_matsubara"], signalArea: area("soho", 1500) },
      { purpose: "verify.local_strength" },
    );
    expect(soho.items).toEqual([]);
  });

  it("finds venues like a venue, near it, and never the venue itself", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.insightsEntities(
      { domain: "place", signalEntities: ["fx_place_the_lantern_room"], filterArea: area("williamsburg", 1000) },
      { purpose: "scout.similar_venues" },
    );
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(items.map((i) => i.id)).not.toContain("fx_place_the_lantern_room");
    expect(items[0].location).toBeDefined();
  });

  it("refuses a place as the taste signal for films or music, as the real API does", async () => {
    const { api } = fixtureEndpoints();
    await expect(
      api.insightsEntities({ domain: "movie", signalEntities: ["fx_place_the_lantern_room"] }, { purpose: "scout.similar_venues" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("does not support video games, as the real API does", async () => {
    const { api } = fixtureEndpoints();
    await expect(
      api.insightsEntities({ domain: "video_game" as never, signalArea: area("soho", 500) }, ctx),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("caps popularity when asked, putting the more distinctive picks first without shrinking the list", async () => {
    const { api } = fixtureEndpoints();
    const plain = await api.insightsEntities({ domain: "movie", signalArea: area("soho", 500) }, ctx);
    const capped = await api.insightsEntities({ domain: "movie", signalArea: area("soho", 500), popularityMax: 0.9 }, ctx);
    expect(capped.items).toHaveLength(plain.items.length);
    expect(capped.items[0].popularity).toBeLessThanOrEqual(0.9);
    expect(capped.items.map((i) => i.id)).not.toEqual(plain.items.map((i) => i.id));
  });

  it("writes places with coordinates, an address and a neighbourhood, and tags in the lookup shape", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.searchEntities({ query: "The Lantern Room Brooklyn", types: ["place"] }, ctx);
    const place = items[0];
    expect(place.location).toEqual({ lat: expect.any(Number), lon: expect.any(Number) });
    expect(place.address).toMatch(/Bedford Ave/);
    expect(place.neighborhood).toBe("Williamsburg");
    expect(place.tags[0].id).toMatch(/^fx_tag_/);
  });
});

describe("check-in tag vectors (fixtures)", () => {
  it("weights tags shared by all favourites highest", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.insightsTags(
      { signalEntities: ["fx_spirited_away", "fx_miki_matsubara", "fx_midnight_diner"] },
      { purpose: "checkin.tags" },
    );
    expect(items[0].name).toBe("Japanese");
    expect(items[0].affinity).toBeGreaterThan(0.9);
  });

  it("gives attendees with overlapping favourites overlapping tags", async () => {
    const { api } = fixtureEndpoints();
    const a = await api.insightsTags({ signalEntities: ["fx_spirited_away", "fx_nujabes"] }, { purpose: "checkin.tags" });
    const b = await api.insightsTags({ signalEntities: ["fx_my_neighbor_totoro", "fx_nujabes"] }, { purpose: "checkin.tags" });
    const c = await api.insightsTags({ signalEntities: ["fx_the_bear", "fx_station_eleven"] }, { purpose: "checkin.tags" });
    const shared = (x: typeof a, y: typeof a) => x.items.filter((t) => y.items.some((u) => u.id === t.id)).length;
    expect(shared(a, b)).toBeGreaterThan(shared(a, c));
  });

  it("still answers for unknown favourites", async () => {
    const { api } = fixtureEndpoints();
    const { items } = await api.insightsTags({ signalEntities: ["fx_nobody"] }, { purpose: "checkin.tags" });
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("call logging in fixtures mode", () => {
  it("returns a call id for every result so signals can cite it", async () => {
    const { api, store } = fixtureEndpoints();
    const result = await api.insightsTags({ signalArea: area("soho", 1500) }, ctx);
    expect(result.callId).toBe("call-1");
    expect(store.calls[0]).toMatchObject({ endpoint: "/v2/insights", status: 200 });
  });
});

describe("pointWkt", () => {
  it("puts longitude first", () => {
    expect(pointWkt(-73.9973, 40.7246)).toBe("POINT(-73.9973 40.7246)");
  });
});
