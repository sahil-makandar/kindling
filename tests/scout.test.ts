import { APICallError, type LanguageModel, type ToolSet } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createLlm } from "@/src/agent/llm";
import { createMemoryLlmStore } from "@/src/agent/llmStore";
import type { ProviderEntry } from "@/src/agent/llmProviders";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createTracer } from "@/src/agent/trace";
import { buildLadder, DOMAIN_LABEL, planFor, SCOUT_DOMAINS } from "@/src/agent/scout/plan";
import { compactEntities, SignalPool, strongestLine, type PoolSignal } from "@/src/agent/scout/pool";
import { MAX_QLOO_CALLS, runDeterministicPlan, ScoutRun, type ScoutApi, type ScoutVenue } from "@/src/agent/scout/scout";
import { createScoutStage } from "@/src/agent/scout/stage";
import { buildScoutTools } from "@/src/agent/scout/tools";
import { QlooError, createQlooClient } from "@/src/qloo/client";
import { createEndpoints } from "@/src/qloo/endpoints";
import type { QlooEntity } from "@/src/qloo/schemas";
import { createMemoryStore } from "@/src/qloo/store";
import { resetUnsupported } from "@/src/qloo/tags";
import { UserFacingError } from "@/src/lib/errors";

beforeEach(() => {
  resetUnsupported();
});

const entity = (id: string, domain: string, affinity: number | undefined, tags: string[] = []): QlooEntity => ({
  id,
  name: id,
  subtype: `urn:entity:${domain}`,
  popularity: 0.5,
  affinity,
  tags: tags.map((t) => ({ id: `t_${t}`, name: t })),
  properties: {},
});

const VENUES: Record<string, ScoutVenue> = {
  soho: { name: "Crosby Street Coffee", venueType: "cafe", lat: 40.7246, lon: -73.9973, city: "New York", qlooEntityId: null },
  williamsburg: {
    name: "The Lantern Room",
    venueType: "cafe",
    lat: 40.7081,
    lon: -73.9571,
    city: "Brooklyn",
    qlooEntityId: "fx_place_the_lantern_room",
  },
  east_austin: { name: "East Side Roasters", venueType: "cafe", lat: 30.263, lon: -97.723, city: "Austin", qlooEntityId: null },
  logan_square: { name: "The Page Turner Cafe", venueType: "cafe", lat: 41.9296, lon: -87.7083, city: "Chicago", qlooEntityId: null },
};

function fixtureSetup(venue: ScoutVenue, overrides: { api?: ScoutApi; maxCalls?: number } = {}) {
  const store = createMemoryStore();
  const client = createQlooClient({ mode: "fixtures", baseUrl: "https://qloo.test", store });
  const api = overrides.api ?? createEndpoints(client.get);
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const trace = createTracer(repo, run.id, "scout");
  const scout = new ScoutRun({ venue, api, trace, runId: run.id, maxCalls: overrides.maxCalls });
  const messages = () => repo.traces.map((t) => t.message);
  return { scout, store, repo, run, trace, api, messages };
}

// ---------------------------------------------------------------- pool

describe("SignalPool", () => {
  it("keeps the highest affinity for an id and remembers every place it appeared", () => {
    const pool = new SignalPool();
    pool.addEntities([entity("a", "movie", 0.8), entity("b", "movie", 0.6)], { domain: "movie", source: "area", callId: "c1" });
    pool.addEntities([entity("b", "movie", 0.9), entity("a", "movie", 0.5)], { domain: "movie", source: "trend", callId: "c2" });

    const a = pool.get("a");
    const b = pool.get("b");
    expect(a).toMatchObject({ affinity: 0.8, source: "area", callId: "c1" });
    expect(b).toMatchObject({ affinity: 0.9, source: "trend", callId: "c2" });
    expect(a?.appearances).toEqual({
      area: { affinity: 0.8, popularity: 0.5, rank: 0, callId: "c1" },
      trend: { affinity: 0.5, popularity: 0.5, rank: 1, callId: "c2" },
    });
    expect(pool.all()).toHaveLength(2);
  });

  it("keeps the better showing when the same source repeats, for example after widening", () => {
    const pool = new SignalPool();
    pool.addEntities([entity("a", "movie", 0.5)], { domain: "movie", source: "area", callId: "narrow" });
    pool.addEntities([entity("a", "movie", 0.7)], { domain: "movie", source: "area", callId: "wide" });
    pool.addEntities([entity("a", "movie", 0.4)], { domain: "movie", source: "area", callId: "later" });
    expect(pool.get("a")?.appearances.area).toMatchObject({ affinity: 0.7, callId: "wide" });
    expect(pool.get("a")?.callId).toBe("wide");
  });

  it("fills in tags and popularity that were missing the first time", () => {
    const pool = new SignalPool();
    pool.addEntities([{ ...entity("a", "movie", 0.5, []), popularity: undefined }], { domain: "movie", source: "area", callId: null });
    pool.addEntities([entity("a", "movie", 0.4, ["x"])], { domain: "movie", source: "venue", callId: null });
    expect(pool.get("a")?.tags.map((t) => t.name)).toEqual(["x"]);
    expect(pool.get("a")?.popularity).toBe(0.5);
  });

  it("separates entities from tags and counts a domain as strong from 5 results with an affinity", () => {
    const pool = new SignalPool();
    const five = ["a", "b", "c", "d", "e"].map((id) => entity(id, "movie", 0.8));
    pool.addEntities(five, { domain: "movie", source: "area", callId: null });
    pool.addEntities(five.slice(0, 4).map((e) => ({ ...e, id: `${e.id}2` })), { domain: "book", source: "area", callId: null });
    pool.addEntities([entity("noaff", "podcast", undefined)], { domain: "podcast", source: "area", callId: null });
    pool.addEntities(five.map((e) => ({ ...e, id: `${e.id}p` })), { domain: "place", source: "places", callId: null });
    pool.addTags([{ id: "tag1", name: "Cozy", affinity: 0.9 }], { source: "area", callId: null });

    expect(pool.strongDomains()).toEqual(["movie"]);
    expect(pool.domains().sort()).toEqual(["book", "movie", "podcast"]);
    expect(pool.tags()).toHaveLength(1);
    expect(pool.entities("place")).toHaveLength(5);
  });

  it("does not count venue-crowd or trend results toward a strong area domain", () => {
    const pool = new SignalPool();
    pool.addEntities(["a", "b", "c", "d", "e"].map((id) => entity(id, "movie", 0.8)), { domain: "movie", source: "venue", callId: null });
    expect(pool.strongDomains()).toEqual([]);
  });

  it("builds the compact summary the model sees", () => {
    const rows = compactEntities([entity("a", "movie", 0.912345, ["t1", "t2", "t3", "t4"])]);
    expect(rows).toEqual([{ id: "a", name: "a", affinity: 0.91, tags: ["t1", "t2", "t3"] }]);
    expect(compactEntities(Array.from({ length: 10 }, (_, i) => entity(`e${i}`, "movie", 0.5)))).toHaveLength(6);
    expect(strongestLine([{ name: "Piranesi", affinity: 0.91 }, { name: "Circe" }])).toBe("Piranesi (0.91), Circe");
  });
});

// ---------------------------------------------------------------- plan

describe("plan and ladder", () => {
  it("scans five different domains first for each kind of venue", () => {
    expect(planFor("bookstore")[0]).toBe("book");
    expect(planFor("brewery")[0]).toBe("artist");
    expect(planFor("bar")).toEqual(planFor("brewery"));
    expect(planFor("cafe")[0]).toBe("movie");
    expect(planFor("music_venue")[1]).toBe("podcast");
    expect(planFor("community_space")).toEqual(planFor("restaurant"));
    for (const type of ["bookstore", "brewery", "bar", "cafe", "music_venue", "restaurant"]) {
      const domains = planFor(type);
      expect(new Set(domains).size).toBe(5);
      for (const d of domains) expect(SCOUT_DOMAINS).toContain(d);
    }
  });

  it("widens from 1.5 km to 3 km to 6 km to the whole city", () => {
    const ladder = buildLadder({ lon: -73.95, lat: 40.7 }, "Brooklyn");
    expect(ladder.map((s) => s.label)).toEqual(["within 1.5 km", "within 3 km", "within 6 km", "across Brooklyn"]);
    expect(ladder.map((s) => s.name)).toEqual(["1.5 km", "3 km", "6 km", "all of Brooklyn"]);
    expect(ladder.map((s) => s.radiusM)).toEqual([1500, 3000, 6000, null]);
    expect(ladder[3].spec).toEqual({ city: "Brooklyn" });
  });

  it("stops at 6 km when the city is unknown", () => {
    expect(buildLadder({ lon: 0, lat: 0 }, null)).toHaveLength(3);
  });

  it("has a label for every domain", () => {
    expect(DOMAIN_LABEL.artist).toBe("music");
    expect(DOMAIN_LABEL.movie).toBe("film");
    expect(DOMAIN_LABEL.place).toBe("places");
  });
});

// ---------------------------------------------------------------- the actions

describe("scan_area", () => {
  it("reads the area, fills the pool and writes the choice and the result into the trace", async () => {
    const { scout, messages } = fixtureSetup(VENUES.soho);
    const result = await scout.scanArea("movie", "Film is the most relevant domain for a cafe");
    expect(result).toMatchObject({ ok: true, domain: "movie", radius: "within 1.5 km", results: 8, thin: false, callsUsed: 1, callsLeft: 15 });
    expect(messages()).toEqual([
      "Next: read the area's taste in film. Film is the most relevant domain for a cafe.",
      "Reading what people within 1.5 km love in film... 8 results. Strongest: In the Mood for Love (0.94), Chungking Express (0.91), Lost in Translation (0.89).",
    ]);
    expect(scout.pool.areaEntities("movie")).toHaveLength(8);
  });

  it("keeps the model's reason in the trace data and cleans dashes out of it", async () => {
    const { scout, repo } = fixtureSetup(VENUES.soho);
    await scout.scanArea("book", "Books next — the area reads a lot");
    const choice = repo.traces[0];
    expect(choice.message).toBe("Next: read the area's taste in books. Books next - the area reads a lot.");
    expect(choice.data).toMatchObject({ tool: "scan_area", domain: "book" });
  });

  it("refuses to repeat a scan at the same radius, without spending a call", async () => {
    const { scout, store } = fixtureSetup(VENUES.soho);
    await scout.scanArea("movie", "first");
    const again = await scout.scanArea("movie", "again");
    expect(again).toMatchObject({ ok: false, error: "Already done at this radius. Pick something new.", callsUsed: 1 });
    expect(store.calls).toHaveLength(1);
  });

  it("flags a thin result, says so, and suggests widening", async () => {
    const { scout, messages } = fixtureSetup(VENUES.logan_square);
    const result = await scout.scanArea("artist", "start with music");
    expect(result).toMatchObject({ ok: true, results: 3, thin: true });
    expect(String(result.hint)).toMatch(/widen_radius once/);
    expect(messages().at(-1)).toBe("Qloo has thin data within 1.5 km for music: only 3 results with an affinity.");
  });

  it("allows the same scan again after widening and gets the full answer", async () => {
    const { scout, messages, store } = fixtureSetup(VENUES.logan_square);
    await scout.scanArea("artist", "start");
    expect(scout.staleDomains()).toEqual([]); // thin, but not yet stale: it was read at the current radius
    const widen = await scout.widenRadius("The first scan came back thin");
    expect(widen).toMatchObject({ ok: true, radius: "within 3 km", stale: ["artist"] });
    expect(messages()).toContain("Qloo has thin data within 1.5 km, widening to 3 km. The first scan came back thin.");
    expect(scout.radiusM).toBe(3000);

    const again = await scout.scanArea("artist", "again, wider");
    expect(again).toMatchObject({ ok: true, results: 8, thin: false });
    expect(scout.staleDomains()).toEqual([]);
    expect(scout.pool.strongDomains()).toEqual(["artist"]);
    expect(store.calls.map((c) => c.params["signal.location.radius"])).toEqual(["1500", "3000"]);
  });

  it("uses the city name as the last step", async () => {
    const { scout, store } = fixtureSetup(VENUES.williamsburg);
    await scout.widenRadius("a");
    await scout.widenRadius("b");
    await scout.widenRadius("c");
    expect(scout.radiusLabel).toBe("across Brooklyn");
    expect(scout.radiusM).toBeNull();
    await scout.scanArea("movie", "city view");
    expect(store.calls[0].params).toMatchObject({ "signal.location.query": "Brooklyn" });
    expect(store.calls[0].params["signal.location"]).toBeUndefined();
    expect(await scout.widenRadius("d")).toMatchObject({ ok: false, error: "Already at the widest view." });
  });

  it("puts the full parameters in the trace when Qloo returns nothing", async () => {
    const empty = {
      insightsEntities: vi.fn(async () => ({
        items: [],
        warnings: [],
        callId: "c9",
        cached: false,
        endpoint: "/v2/insights",
        params: { "filter.type": "urn:entity:movie", take: "15" },
        empty: true,
      })),
    } as unknown as ScoutApi;
    const { scout, messages } = fixtureSetup(VENUES.soho, { api: empty });
    const result = await scout.scanArea("movie", "check");
    expect(result).toMatchObject({ ok: true, results: 0, thin: true });
    expect(messages().some((m) => m.startsWith("Qloo returned nothing for film within 1.5 km.") && m.includes("filter.type=urn:entity:movie, take=15"))).toBe(true);
  });

  it("tells the model about a Qloo failure and lets it carry on", async () => {
    const failing = {
      insightsEntities: vi.fn(async () => {
        throw new QlooError("Qloo took too long to answer.", 0);
      }),
    } as unknown as ScoutApi;
    const { scout, messages } = fixtureSetup(VENUES.soho, { api: failing });
    const result = await scout.scanArea("movie", "check");
    expect(result).toMatchObject({ ok: false, error: "Qloo took too long to answer.", callsUsed: 1 });
    expect(messages().at(-1)).toBe("Could not read film: Qloo took too long to answer.");
  });

  it("does not hide real bugs", async () => {
    const broken = {
      insightsEntities: vi.fn(async () => {
        throw new TypeError("bug");
      }),
    } as unknown as ScoutApi;
    const { scout } = fixtureSetup(VENUES.soho, { api: broken });
    await expect(scout.scanArea("movie", "check")).rejects.toThrow("bug");
  });
});

describe("the other actions", () => {
  it("reads area tags from Qloo's tag view when it works", async () => {
    const { scout, messages } = fixtureSetup(VENUES.williamsburg);
    await scout.scanArea("movie", "x");
    const result = await scout.scanAreaTags("Need the area's vocabulary");
    expect(result).toMatchObject({ ok: true, source: "qloo_tags", callsUsed: 2 });
    expect(messages().at(-1)).toMatch(/^Reading the area's tag vocabulary\.\.\. 11 tags\. Top: Japanese \(0\.95\)/);
    expect(scout.pool.tags()).toHaveLength(11);
  });

  it("falls back to the tags on the area's entities when Qloo has no tag view, and counts the failed try", async () => {
    const store = createMemoryStore();
    const real = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
    const api: ScoutApi = {
      ...real,
      insightsTags: vi.fn(async () => {
        throw new QlooError("Qloo does not allow this kind of request with our key (status 403).", 403);
      }),
    };
    const { scout, messages } = fixtureSetup(VENUES.williamsburg, { api });
    await scout.scanArea("movie", "x");
    const result = await scout.scanAreaTags("vocabulary");
    expect(result).toMatchObject({ ok: true, source: "entity_tags", callsUsed: 2 });
    expect(messages().some((m) => m.includes("Reading the tags carried by the area's top results instead."))).toBe(true);
    expect(scout.pool.tags().length).toBeGreaterThan(3);
  });

  it("does not count a call for tags it never asked Qloo for", async () => {
    const store = createMemoryStore();
    const real = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
    const forbidden = vi.fn(async () => {
      throw new QlooError("nope (status 403)", 403);
    });
    const api: ScoutApi = { ...real, insightsTags: forbidden };
    const first = fixtureSetup(VENUES.soho, { api });
    await first.scout.scanArea("movie", "x");
    await first.scout.scanAreaTags("first");
    const second = fixtureSetup(VENUES.soho, { api });
    await second.scout.scanArea("movie", "x");
    const result = await second.scout.scanAreaTags("second");
    expect(forbidden).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ source: "entity_tags", callsUsed: 1 });
  });

  it("refuses a venue-crowd scan when the venue is not in Qloo, without a call", async () => {
    const { scout, store } = fixtureSetup(VENUES.soho);
    const result = await scout.scanVenueCrowd("movie", "see who comes here");
    expect(result).toMatchObject({ ok: false });
    expect(String(result.error)).toMatch(/not in Qloo/);
    expect(store.calls).toHaveLength(0);
  });

  it("reads the venue's own crowd when the venue is in Qloo", async () => {
    const { scout, messages } = fixtureSetup(VENUES.williamsburg);
    const result = await scout.scanVenueCrowd("movie", "see who comes here");
    expect(result).toMatchObject({ ok: true, domain: "movie" });
    expect(messages().at(-1)).toMatch(/^Reading what people who love The Lantern Room also love in film\.\.\. 8 results\. Strongest: /);
    expect(scout.pool.get("fx_spirited_away")?.appearances.venue).toBeDefined();
    expect(scout.pool.strongDomains()).toEqual([]);
  });

  it("reads what is rising and records each rank", async () => {
    const { scout } = fixtureSetup(VENUES.soho);
    await scout.scanArea("artist", "x");
    await scout.scanTrending("artist", "momentum");
    const trending = scout.pool.entities("artist").filter((s) => s.appearances.trend);
    expect(trending).toHaveLength(8);
    expect(trending.map((s) => s.appearances.trend?.rank).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("reads the nearby places into the pool", async () => {
    const { scout, messages } = fixtureSetup(VENUES.williamsburg);
    const result = await scout.scanNearbyPlaces("food scene");
    expect(result).toMatchObject({ ok: true, results: 6 });
    expect(scout.pool.entities("place")).toHaveLength(6);
    expect(messages().at(-1)).toMatch(/^Looking at the places nearby\.\.\. 6 places: Tonkotsu Alley/);
  });
});

describe("budget", () => {
  it("keeps the last three calls for re-scans: new scans stop first, re-scans may use the rest", async () => {
    const { scout, store } = fixtureSetup(VENUES.logan_square, { maxCalls: 5 });
    await scout.scanArea("artist", "1");
    await scout.scanArea("movie", "2");
    const blocked = await scout.scanArea("book", "3");
    expect(blocked.ok).toBe(false);
    expect(String(blocked.error)).toMatch(/last 3 calls are kept for re-scans/);

    await scout.widenRadius("thin");
    expect((await scout.scanArea("artist", "again")).ok).toBe(true);
    expect((await scout.scanArea("movie", "again")).ok).toBe(true);
    expect(scout.callsUsed).toBe(4);
    expect(store.calls).toHaveLength(4);
  });

  it("refuses everything once the budget is spent", async () => {
    const { scout, store } = fixtureSetup(VENUES.soho, { maxCalls: 1 });
    expect((await scout.scanArea("movie", "x")).ok).toBe(false);
    expect(store.calls).toHaveLength(0);
    const scoutB = fixtureSetup(VENUES.soho, { maxCalls: 3 });
    await scoutB.scout.scanArea("movie", "x");
    const spent = await scoutB.scout.scanArea("book", "y");
    expect(spent.ok).toBe(false);
  });

  it("never spends more than the budget when a model keeps asking", async () => {
    const { scout, store, run } = fixtureSetup(VENUES.williamsburg);
    const tools = buildScoutTools(scout);
    for (let round = 0; round < 6; round++) {
      for (const domain of SCOUT_DOMAINS) {
        await exec(tools, "scan_area", { domain, reason: "again and again" });
        await exec(tools, "scan_trending", { domain, reason: "more" });
        await exec(tools, "scan_venue_crowd", { domain, reason: "more" });
      }
      await exec(tools, "scan_area_tags", { reason: "more" });
      await exec(tools, "scan_nearby_places", { reason: "more" });
      await exec(tools, "widen_radius", { reason: "more" });
    }
    expect(scout.callsUsed).toBeLessThanOrEqual(MAX_QLOO_CALLS);
    expect(store.calls.length).toBeLessThanOrEqual(MAX_QLOO_CALLS);
    expect(run.id).toBeTruthy();
  });
});

describe("finish", () => {
  it("is refused while the pool is thin, and says what is missing", async () => {
    const { scout } = fixtureSetup(VENUES.soho);
    const refused = await scout.finish("done already");
    expect(refused.ok).toBe(false);
    expect(String(refused.error)).toBe(
      "Not enough yet. Still missing: 4 more domains with 5+ results; the area's tags; a trend scan or nearby places. Keep scouting.",
    );
    expect(scout.finished).toBe(false);
  });

  it("is accepted once the standard plan has covered everything, and then locks the tools", async () => {
    const { scout, messages } = fixtureSetup(VENUES.soho);
    await runDeterministicPlan(scout);
    expect(scout.isEnough()).toBe(true);
    expect(await scout.finish("The area loves arthouse film and jazz")).toMatchObject({ ok: true });
    expect(messages().at(-1)).toBe("Scout summary: The area loves arthouse film and jazz.");
    expect(await scout.scanArea("book", "late")).toMatchObject({ ok: false, error: "Scouting is already finished." });
    expect(await scout.widenRadius("late")).toMatchObject({ ok: false });
  });

  it("is accepted when the budget is gone even if the pool is thin", async () => {
    const { scout } = fixtureSetup(VENUES.logan_square, { maxCalls: 6 });
    await scout.scanArea("artist", "1");
    await scout.scanArea("movie", "2");
    await scout.scanArea("book", "3");
    await scout.widenRadius("thin");
    await scout.scanArea("artist", "again");
    await scout.scanArea("movie", "again");
    await scout.scanArea("book", "again");
    expect(scout.callsLeft).toBe(0);
    expect(await scout.finish("out of budget")).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------- the standard plan

describe("deterministic plan", () => {
  it.each(Object.keys(VENUES))("covers %s within the budget", async (key) => {
    const { scout, store } = fixtureSetup(VENUES[key]);
    await runDeterministicPlan(scout);
    expect(scout.pool.strongDomains().length).toBeGreaterThanOrEqual(4);
    expect(scout.pool.tags().length).toBeGreaterThan(0);
    expect(scout.pool.entities("place").length).toBeGreaterThan(0);
    expect(scout.pool.entities().some((s) => s.appearances.trend)).toBe(true);
    expect(scout.callsUsed).toBeLessThanOrEqual(MAX_QLOO_CALLS);
    expect(store.calls).toHaveLength(scout.callsUsed);
    expect(scout.isEnough()).toBe(true);
  });

  it("widens once for Logan Square and says why", async () => {
    const { scout, messages } = fixtureSetup(VENUES.logan_square);
    await runDeterministicPlan(scout);
    expect(scout.radiusM).toBe(3000);
    expect(messages().filter((m) => m.startsWith("Qloo has thin data within 1.5 km, widening to 3 km."))).toHaveLength(1);
    expect(scout.staleDomains()).toEqual([]);
  });

  it("does not widen where Qloo already has enough", async () => {
    const { scout } = fixtureSetup(VENUES.soho);
    await runDeterministicPlan(scout);
    expect(scout.radiusM).toBe(1500);
  });

  it("reads the venue crowd only when the venue is in Qloo", async () => {
    const withVenue = fixtureSetup(VENUES.williamsburg);
    await runDeterministicPlan(withVenue.scout);
    expect(withVenue.store.calls.filter((c) => c.purpose === "scout.venue_crowd")).toHaveLength(2);
    const without = fixtureSetup(VENUES.soho);
    await runDeterministicPlan(without.scout);
    expect(without.store.calls.filter((c) => c.purpose === "scout.venue_crowd")).toHaveLength(0);
  });

  it("starts with the most relevant domain for the venue type", async () => {
    const bookstore = fixtureSetup({ ...VENUES.soho, venueType: "bookstore" });
    await runDeterministicPlan(bookstore.scout);
    expect(bookstore.store.calls[0].params["filter.type"]).toBe("urn:entity:book");
    const brewery = fixtureSetup({ ...VENUES.soho, venueType: "brewery" });
    await runDeterministicPlan(brewery.scout);
    expect(brewery.store.calls[0].params["filter.type"]).toBe("urn:entity:artist");
  });

  it("uses every Qloo capability: area taste, tags, places, trends and the venue crowd", async () => {
    const { scout, store } = fixtureSetup(VENUES.williamsburg);
    await runDeterministicPlan(scout);
    const purposes = new Set(store.calls.map((c) => c.purpose));
    expect(purposes).toEqual(
      new Set(["scout.area_entities", "scout.area_tags", "scout.places", "scout.trending", "scout.venue_crowd"]),
    );
  });

  it("is idempotent: a second run does nothing new", async () => {
    const { scout, store } = fixtureSetup(VENUES.soho);
    await runDeterministicPlan(scout);
    const calls = store.calls.length;
    await runDeterministicPlan(scout);
    expect(store.calls).toHaveLength(calls);
  });
});

// ---------------------------------------------------------------- the tools and the stage

type Executable = { execute?: (input: unknown, options: unknown) => PromiseLike<unknown> | unknown };

async function exec(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  const run = (tools[name] as unknown as Executable).execute;
  if (!run) throw new Error(`tool ${name} has no execute`);
  return run(input, { toolCallId: `call-${name}`, messages: [] });
}

describe("tools", () => {
  it("define the seven tools from the spec", () => {
    const { scout } = fixtureSetup(VENUES.soho);
    expect(Object.keys(buildScoutTools(scout)).sort()).toEqual(
      ["finish", "scan_area", "scan_area_tags", "scan_nearby_places", "scan_trending", "scan_venue_crowd", "widen_radius"].sort(),
    );
  });

  it("reject an unknown domain and a missing reason before anything runs", () => {
    const { scout } = fixtureSetup(VENUES.soho);
    const schema = (buildScoutTools(scout).scan_area as unknown as { inputSchema: z.ZodType }).inputSchema;
    expect(schema.safeParse({ domain: "movie", reason: "Film fits a cafe" }).success).toBe(true);
    expect(schema.safeParse({ domain: "fashion", reason: "Film fits a cafe" }).success).toBe(false);
    expect(schema.safeParse({ domain: "movie" }).success).toBe(false);
    expect(schema.safeParse({ domain: "movie", reason: "" }).success).toBe(false);
  });

  it("forward to the Scout", async () => {
    const { scout } = fixtureSetup(VENUES.soho);
    const result = await exec(buildScoutTools(scout), "scan_area", { domain: "movie", reason: "Film fits a cafe" });
    expect(result).toMatchObject({ ok: true, domain: "movie" });
  });
});

function stageSetup(
  venueKey: string,
  over: { runToolLoop?: Parameters<typeof createScoutStage>[0]["runToolLoop"]; api?: ScoutApi; maxQlooCalls?: number; now?: () => number } = {},
) {
  const venue = VENUES[venueKey];
  const store = createMemoryStore();
  const real = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const trace = createTracer(repo, run.id, "scout");
  const saved: PoolSignal[][] = [];
  const radii: Array<number | null> = [];
  const llm = createLlm({ mode: "mock", providers: [], store: createMemoryLlmStore() });
  const stage = createScoutStage({
    getVenue: async () => ({
      id: run.venueId,
      name: venue.name,
      address: `1 Test St, ${venue.city}, XX`,
      lat: venue.lat,
      lon: venue.lon,
      venueType: venue.venueType,
      qlooEntityId: venue.qlooEntityId,
    }),
    saveSignals: async (_runId, signals) => {
      saved.push(signals);
    },
    saveRadius: async (_runId, radiusM) => {
      radii.push(radiusM);
    },
    api: over.api ?? real,
    runToolLoop: over.runToolLoop ?? llm.runToolLoop,
    maxQlooCalls: over.maxQlooCalls,
    now: over.now,
  });
  return { stage, store, repo, run, trace, saved, radii, messages: () => repo.traces.map((t) => t.message) };
}

describe("Scout stage", () => {
  it("runs the standard plan in mock mode, saves the pool and the radius, and reports the totals", async () => {
    const { stage, repo, run, trace, saved, radii, messages, store } = stageSetup("williamsburg");
    await stage({ run, trace });
    expect(messages()[0]).toBe(
      "Scouting around The Lantern Room. I have 16 Qloo calls to spend and will pick each one from what I find.",
    );
    expect(messages().at(-1)).toMatch(/^Scouting done: \d+ Qloo calls, \d strong domains \(.*\), \d+ area tags, 6 nearby places, read within 1\.5 km\.$/);
    expect(saved).toHaveLength(1);
    expect(saved[0].length).toBeGreaterThan(40);
    expect(radii).toEqual([1500]);
    expect(store.calls.length).toBeLessThanOrEqual(16);
    expect(repo.traces.every((t) => t.stage === "scout")).toBe(true);
  });

  it("records the widened radius", async () => {
    const { stage, run, trace, radii } = stageSetup("logan_square");
    await stage({ run, trace });
    expect(radii).toEqual([3000]);
  });

  it("lets a model choose each next call from what it found, and explains each choice", async () => {
    // A scripted "model": it reads each result and decides what to do next.
    const script: Parameters<typeof createScoutStage>[0]["runToolLoop"] = async (tools, _system, opts) => {
      const first = (await exec(tools, "scan_area", { domain: "movie", reason: "Film is the closest fit for a cafe" })) as { top: Array<{ name: string }> };
      const lead = first.top[0].name;
      await exec(tools, "scan_area", { domain: "book", reason: `${lead} leads film, so check whether books follow` });
      await exec(tools, "scan_trending", { domain: "movie", reason: `See whether ${lead} is still rising` });
      await exec(tools, "scan_area", { domain: "artist", reason: "Music pairs with film nights" });
      await exec(tools, "scan_area", { domain: "tv_show", reason: "Fill the fourth domain" });
      const early = (await exec(tools, "finish", { summary: "enough" })) as { ok: boolean; error?: string };
      expect(early.ok).toBe(false);
      expect(early.error).toMatch(/the area's tags/);
      await exec(tools, "scan_area_tags", { reason: "Need the area's words before finishing" });
      const done = (await exec(tools, "finish", { summary: "The area loves arthouse film, books and jazz" })) as { ok: boolean };
      expect(done.ok).toBe(true);
      await opts.trace?.info("scripted model finished");
      return { source: "llm", steps: 8, provider: "google", model: "scripted" };
    };
    const { stage, run, trace, store, messages } = stageSetup("soho", { runToolLoop: script });
    await stage({ run, trace });

    expect(store.calls.map((c) => c.purpose)).toEqual([
      "scout.area_entities",
      "scout.area_entities",
      "scout.trending",
      "scout.area_entities",
      "scout.area_entities",
      "scout.area_tags",
    ]);
    expect(messages()).toContain("Next: read the area's taste in books. In the Mood for Love leads film, so check whether books follow.");
    expect(messages()).toContain("Next: check what is rising in film. See whether In the Mood for Love is still rising.");
    // The model finished properly, so the standard plan did not run on top.
    expect(messages().some((m) => m.startsWith("Not enough yet"))).toBe(false);
    expect(messages().filter((m) => m.startsWith("Scouting done"))).toHaveLength(1);
  });

  it("tops up with the standard plan when a model stops early", async () => {
    const lazy: Parameters<typeof createScoutStage>[0]["runToolLoop"] = async (tools) => {
      await exec(tools, "scan_area", { domain: "movie", reason: "Start with film" });
      await exec(tools, "scan_area", { domain: "book", reason: "Then books" });
      return { source: "llm", steps: 2 };
    };
    const { stage, run, trace, messages, saved, store } = stageSetup("east_austin", { runToolLoop: lazy });
    await stage({ run, trace });
    expect(messages().some((m) => m.startsWith("Not enough yet (") && m.endsWith("so I am finishing with the standard plan."))).toBe(true);
    const signals = saved[0];
    expect(new Set(signals.filter((s) => s.kind === "entity" && s.appearances.area).map((s) => s.domain)).size).toBeGreaterThanOrEqual(4);
    expect(signals.some((s) => s.kind === "tag")).toBe(true);
    expect(store.calls.length).toBeLessThanOrEqual(16);
    // The two domains the model already scanned were not scanned again.
    expect(store.calls.filter((c) => c.params["filter.type"] === "urn:entity:movie" && c.purpose === "scout.area_entities")).toHaveLength(1);
  });

  it("hands over to the standard plan without repeating work when the model fails part-way", async () => {
    const provider: ProviderEntry = { name: "google", label: "Gemini", model: () => ({ id: "g", model: {} as unknown as LanguageModel }) };
    const live = createLlm({
      mode: "live",
      providers: [provider],
      store: createMemoryLlmStore(),
      sleep: async () => undefined,
      callLoop: async ({ tools, onStep }) => {
        await exec(tools, "scan_area", { domain: "movie", reason: "Film first" });
        onStep();
        await exec(tools, "scan_area", { domain: "book", reason: "Books next" });
        onStep();
        throw new APICallError({ message: "busy", url: "https://x", requestBodyValues: {}, statusCode: 429 });
      },
    });
    const { stage, run, trace, messages, store } = stageSetup("soho", { runToolLoop: live.runToolLoop });
    await stage({ run, trace });
    expect(messages()).toContain("Gemini is busy.");
    expect(messages()).toContain("The language model is busy, using the standard plan.");
    const areaScans = store.calls.filter((c) => c.purpose === "scout.area_entities");
    const domains = areaScans.map((c) => c.params["filter.type"]);
    expect(new Set(domains).size).toBe(domains.length);
    expect(store.calls.length).toBeLessThanOrEqual(16);
  });

  it("stays inside the budget however the model behaves", async () => {
    const spam: Parameters<typeof createScoutStage>[0]["runToolLoop"] = async (tools) => {
      for (let i = 0; i < 40; i++) {
        for (const domain of SCOUT_DOMAINS) await exec(tools, "scan_area", { domain, reason: "more" });
        await exec(tools, "widen_radius", { reason: "more" });
        await exec(tools, "scan_trending", { domain: "movie", reason: "more" });
      }
      return { source: "llm", steps: 8 };
    };
    const { stage, run, trace, store } = stageSetup("williamsburg", { runToolLoop: spam });
    await stage({ run, trace });
    expect(store.calls.length).toBeLessThanOrEqual(16);
  });

  it("keeps what it found and stops the run with a plain message when Qloo has almost nothing", async () => {
    const barren = {
      insightsEntities: vi.fn(async () => ({ items: [], warnings: [], callId: null, cached: false, endpoint: "/v2/insights", params: {}, empty: true })),
      insightsTags: vi.fn(async () => ({ items: [], warnings: [], callId: null, cached: false, endpoint: "/v2/insights", params: {}, empty: true })),
      getEntities: vi.fn(),
    } as unknown as ScoutApi;
    const { stage, run, trace, saved, messages } = stageSetup("soho", { api: barren });
    await expect(stage({ run, trace })).rejects.toThrow(UserFacingError);
    await expect(stageSetup("soho", { api: barren }).stage({ run, trace })).rejects.toThrow(
      "Qloo has too little taste data around this address to build clubs.",
    );
    expect(saved).toHaveLength(1);
    expect(messages().some((m) => m.startsWith("Qloo returned nothing for film"))).toBe(true);
  });

  it("saves the partial pool even when a step throws", async () => {
    const crash: Parameters<typeof createScoutStage>[0]["runToolLoop"] = async (tools) => {
      await exec(tools, "scan_area", { domain: "movie", reason: "Film" });
      throw new Error("something unexpected");
    };
    const { stage, run, trace, saved } = stageSetup("soho", { runToolLoop: crash });
    await expect(stage({ run, trace })).rejects.toThrow("something unexpected");
    expect(saved).toHaveLength(1);
    expect(saved[0].filter((s) => s.domain === "movie").length).toBe(8);
  });

  it("fails clearly when the venue row is missing", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const stage = createScoutStage({
      getVenue: async () => null,
      saveSignals: async () => undefined,
      saveRadius: async () => undefined,
      api: {} as ScoutApi,
      runToolLoop: createLlm({ mode: "mock", providers: [], store: createMemoryLlmStore() }).runToolLoop,
    });
    await expect(stage({ run, trace: createTracer(repo, run.id, "scout") })).rejects.toThrow(/not found/);
  });
});

// ---------------------------------------------------------------- the time limit and parallel calls

describe("time limit", () => {
  function timed(venue: ScoutVenue) {
    let clock = 1_000;
    const store = createMemoryStore();
    const api = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const trace = createTracer(repo, run.id, "scout");
    const scout = new ScoutRun({ venue, api, trace, runId: run.id, deadlineAt: 10_000, now: () => clock });
    return { scout, store, tick: (to: number) => (clock = to) };
  }

  it("works until the deadline and then refuses to start anything new", async () => {
    const { scout, store, tick } = timed(VENUES.soho);
    expect((await scout.scanArea("movie", "x")).ok).toBe(true);
    expect(scout.timeUp).toBe(false);
    tick(10_001);
    expect(scout.timeUp).toBe(true);
    expect(await scout.scanArea("book", "late")).toMatchObject({ ok: false, error: "Out of time for scouting. Call finish." });
    expect(await scout.scanAreaTags("late")).toMatchObject({ ok: false });
    expect(await scout.widenRadius("late")).toMatchObject({ ok: false });
    expect(store.calls).toHaveLength(1);
  });

  it("lets the model finish when time is up even though the pool is thin", async () => {
    const { scout, tick } = timed(VENUES.soho);
    await scout.scanArea("movie", "x");
    tick(20_000);
    expect(await scout.finish("out of time")).toMatchObject({ ok: true });
  });

  it("makes the standard plan stop quietly instead of looping", async () => {
    const { scout, store, tick } = timed(VENUES.soho);
    tick(20_000);
    await runDeterministicPlan(scout);
    expect(store.calls).toHaveLength(0);
  });
});

describe("parallel tool calls", () => {
  it("run one after another, so a repeated request is a duplicate and costs nothing", async () => {
    const { scout, store } = fixtureSetup(VENUES.soho);
    const tools = buildScoutTools(scout);
    const results = (await Promise.all(
      Array.from({ length: 5 }, () => exec(tools, "scan_area", { domain: "movie", reason: "same again" })),
    )) as Array<{ ok: boolean }>;
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(store.calls).toHaveLength(1);
    expect(scout.callsUsed).toBe(1);
  });

  it("all succeed when the scans are different, and the count stays exact", async () => {
    const { scout, store } = fixtureSetup(VENUES.soho);
    const tools = buildScoutTools(scout);
    const results = (await Promise.all(
      ["movie", "book", "artist"].map((domain) => exec(tools, "scan_area", { domain, reason: "batch" })),
    )) as Array<{ ok: boolean }>;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(scout.callsUsed).toBe(3);
    expect(store.calls).toHaveLength(3);
  });

  it("cannot overspend the budget when many calls arrive together", async () => {
    const { scout, store } = fixtureSetup(VENUES.williamsburg);
    const tools = buildScoutTools(scout);
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        exec(tools, i % 2 === 0 ? "scan_trending" : "scan_area", { domain: SCOUT_DOMAINS[i % 6], reason: "burst" }),
      ),
    );
    expect(store.calls.length).toBeLessThanOrEqual(MAX_QLOO_CALLS);
    expect(scout.callsUsed).toBe(store.calls.length);
  });

  it("keeps working after one queued call throws", async () => {
    const { scout } = fixtureSetup(VENUES.soho);
    await expect(scout.serial(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(scout.serial(async () => "next")).resolves.toBe("next");
  });
});

describe("Scout stage and the clock", () => {
  it("stops with what it has when time runs out, says so, and still finishes if there is enough", async () => {
    let clock = 0;
    const script: Parameters<typeof createScoutStage>[0]["runToolLoop"] = async (tools) => {
      await exec(tools, "scan_area", { domain: "movie", reason: "one" });
      await exec(tools, "scan_area", { domain: "book", reason: "two" });
      await exec(tools, "scan_area", { domain: "artist", reason: "three" });
      clock = 60_000;
      return { source: "llm", steps: 3 };
    };
    const { stage, run, trace, messages, saved, store } = stageSetup("soho", { runToolLoop: script, now: () => clock });
    await stage({ run, trace });
    expect(messages()).toContain("Time was nearly up, so I stopped scouting with what I had found.");
    expect(store.calls).toHaveLength(3);
    expect(saved[0].length).toBeGreaterThan(20);
  });

  it("fails with the plain message when time runs out before there is enough to design from", async () => {
    let clock = 0;
    const script: Parameters<typeof createScoutStage>[0]["runToolLoop"] = async (tools) => {
      await exec(tools, "scan_area", { domain: "movie", reason: "one" });
      clock = 60_000;
      return { source: "llm", steps: 1 };
    };
    const { stage, run, trace, saved } = stageSetup("soho", { runToolLoop: script, now: () => clock });
    await expect(stage({ run, trace })).rejects.toThrow("Qloo has too little taste data around this address");
    expect(saved).toHaveLength(1);
  });
});
