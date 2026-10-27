import { describe, expect, it } from "vitest";
import {
  cityFromAddress,
  createLocateStage,
  nameSimilarity,
  pickVenueMatch,
  type VenueInput,
  type VenueMatch,
} from "@/src/agent/locator";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createRunner, STAGE_ORDER, type RunnableStage, type StageFn } from "@/src/agent/runStage";
import { createTracer } from "@/src/agent/trace";
import { createQlooClient } from "@/src/qloo/client";
import { createEndpoints } from "@/src/qloo/endpoints";
import type { QlooEntity } from "@/src/qloo/schemas";
import { createMemoryStore } from "@/src/qloo/store";

const place = (id: string, name: string, tags: string[], geo?: [number, number]): QlooEntity => ({
  id,
  name,
  subtype: "urn:entity:place",
  tags: tags.map((t) => ({ id: `t_${t}`, name: t })),
  properties: {},
  ...(geo ? { location: { lat: geo[0], lon: geo[1] } } : {}),
});

const found = (items: QlooEntity[]) => ({ items, endpoint: "/search", params: {} as Record<string, string> });

const lanternRoom: Pick<VenueInput, "name" | "lat" | "lon"> = { name: "The Lantern Room", lat: 40.708, lon: -73.957 };

describe("nameSimilarity", () => {
  it("ignores case, punctuation and small words", () => {
    expect(nameSimilarity("The Lantern Room", "lantern room")).toBe(1);
    expect(nameSimilarity("Joe's Coffee", "Joes Coffee")).toBe(1);
    expect(nameSimilarity("Salt & Pepper", "Salt and Pepper")).toBe(1);
  });

  it("scores partial overlap between 0 and 1", () => {
    expect(nameSimilarity("The Lantern Room", "Lantern Records")).toBeCloseTo(1 / 3, 5);
    expect(nameSimilarity("The Lantern Room", "Lantern Room Cafe")).toBeCloseTo(2 / 3, 5);
  });

  it("is 0 for unrelated or empty names", () => {
    expect(nameSimilarity("Lantern Room", "Tin Roof")).toBe(0);
    expect(nameSimilarity("", "Anything")).toBe(0);
    expect(nameSimilarity("The", "The")).toBe(0);
  });
});

describe("cityFromAddress", () => {
  it.each([
    ["112 Bedford Ave, Brooklyn, NY 11249, USA", "Brooklyn, NY"],
    ["100 Crosby St, New York, NY", "New York, NY"],
    ["1205 E 6th St, Austin", "Austin"],
    ["Brooklyn, NY", "Brooklyn, NY"],
    ["12 High Street", ""],
  ])("%s gives %s", (address, city) => {
    expect(cityFromAddress(address)).toBe(city);
  });
});

describe("pickVenueMatch", () => {
  it("accepts a close name with a hospitality category", () => {
    const { match, skipped } = pickVenueMatch(lanternRoom, [place("p1", "The Lantern Room", ["Cafe"])]);
    expect(match).toEqual({ id: "p1", name: "The Lantern Room", category: "cafe", tags: [{ id: "t_Cafe", name: "Cafe" }] });
    expect(skipped).toEqual([]);
  });

  it("skips a look-alike record store and explains why", () => {
    const { match, skipped } = pickVenueMatch(lanternRoom, [
      place("p2", "Lantern Records", ["Record Store"]),
      place("p1", "The Lantern Room", ["Cafe"]),
    ]);
    expect(match?.id).toBe("p1");
    expect(skipped).toEqual([{ name: "Lantern Records", reason: "different name" }]);
  });

  it("skips a same-named museum or gallery", () => {
    const { match, skipped } = pickVenueMatch(lanternRoom, [
      place("m1", "The Lantern Room", ["Museum", "Art Gallery"]),
    ]);
    expect(match).toBeNull();
    expect(skipped).toEqual([{ name: "The Lantern Room", reason: "museum" }]);
  });

  it("picks the best of several matches by name, then by distance", () => {
    const { match } = pickVenueMatch(lanternRoom, [
      place("a", "Lantern Room Cafe", ["Cafe"], [40.71, -73.96]),
      place("b", "The Lantern Room", ["Bar"], [40.72, -73.99]),
      place("c", "The Lantern Room", ["Bar"], [40.709, -73.958]),
    ]);
    expect(match?.id).toBe("c");
  });

  it("skips a same-named place in another city", () => {
    const { match, skipped } = pickVenueMatch(lanternRoom, [place("far", "The Lantern Room", ["Cafe"], [41.88, -87.63])]);
    expect(match).toBeNull();
    expect(skipped[0].reason).toBe("too far away");
  });

  it("labels a bookstore cafe by what the owner says it is, not by the first category Qloo lists", () => {
    const tagged = (names: string[]): QlooEntity => ({
      ...place("p", "Corner Books", []),
      tags: names.map((n) => ({ id: `c_${n}`, name: n, type: "urn:tag:category:place" })),
    });
    const hit = tagged(["Place", "Restaurant", "Shopping", "Event venue", "Cafe", "Book store"]);
    const venue = { name: "Corner Books Cafe", lat: 40.7, lon: -74 };
    expect(pickVenueMatch({ ...venue, venueType: "bookstore" }, [hit]).match?.category).toBe("book store");
    expect(pickVenueMatch({ ...venue, venueType: "cafe" }, [hit]).match?.category).toBe("cafe");
    expect(pickVenueMatch(venue, [hit]).match?.category).toBe("restaurant");
  });

  it("uses Qloo's category tags rather than ambience or interest tags to judge a venue", () => {
    const hit: QlooEntity = {
      ...place("p", "The Lantern Room", []),
      tags: [
        { id: "a1", name: "Cozy bar vibes", type: "urn:tag:ambience:qloo" },
        { id: "c1", name: "Tattoo shop", type: "urn:tag:category:place" },
      ],
    };
    const { match, skipped } = pickVenueMatch(lanternRoom, [hit]);
    expect(match).toBeNull();
    expect(skipped).toEqual([{ name: "The Lantern Room", reason: "tattoo shop" }]);
  });

  it("keeps a match with no category information and no coordinates", () => {
    const { match } = pickVenueMatch(lanternRoom, [place("p", "The Lantern Room", [])]);
    expect(match).toEqual({ id: "p", name: "The Lantern Room", category: null, tags: [] });
  });

  it("returns no match for an empty result list", () => {
    expect(pickVenueMatch(lanternRoom, [])).toEqual({ match: null, skipped: [] });
  });

  it("uses the first plausible category, not just the first one", () => {
    const { match } = pickVenueMatch(lanternRoom, [place("p", "The Lantern Room", ["Local Favourite", "Wine Bar"])]);
    expect(match?.category).toBe("wine bar");
  });
});

// The Locator against the offline Qloo fixtures, for each fixture neighbourhood.
function fixtureLocator(venue: VenueInput) {
  const store = createMemoryStore();
  const client = createQlooClient({ mode: "fixtures", baseUrl: "https://qloo.test", store });
  const api = createEndpoints(client.get);
  const saved: Array<{ venueId: string; match: VenueMatch }> = [];
  const repo = createMemoryRunRepo();
  const run = repo.addRun({ venueId: venue.id });
  const stage = createLocateStage({
    getVenue: async () => venue,
    saveMatch: async (venueId, match) => {
      saved.push({ venueId, match });
    },
    searchPlaces: ({ query }, { runId }) => api.searchEntities({ query, types: ["place"] }, { purpose: "locate.venue", runId }),
  });
  return { stage, saved, repo, run, store };
}

const venues: Array<{ label: string; venue: VenueInput; expectedName: string; expectedCategory: string }> = [
  {
    label: "SoHo",
    venue: { id: "v1", name: "Crosby Street Coffee", address: "98 Crosby St, New York, NY", lat: 40.7246, lon: -73.9973, venueType: "cafe" },
    expectedName: "Crosby Street Coffee",
    expectedCategory: "cafe",
  },
  {
    label: "Williamsburg",
    venue: { id: "v2", name: "The Lantern Room", address: "112 Bedford Ave, Brooklyn, NY", lat: 40.7081, lon: -73.9571, venueType: "cafe" },
    expectedName: "The Lantern Room",
    expectedCategory: "cafe",
  },
  {
    label: "East Austin",
    venue: { id: "v3", name: "East Side Roasters", address: "1205 E 6th St, Austin, TX", lat: 30.263, lon: -97.723, venueType: "cafe" },
    expectedName: "East Side Roasters",
    expectedCategory: "cafe",
  },
  {
    label: "Logan Square",
    venue: { id: "v4", name: "The Page Turner Cafe", address: "2619 N Milwaukee Ave, Chicago, IL", lat: 41.9296, lon: -87.7083, venueType: "cafe" },
    expectedName: "The Page Turner Cafe",
    expectedCategory: "cafe",
  },
];

describe("Locator stage with fixtures", () => {
  it.each(venues)("finds the venue in $label", async ({ venue, expectedName, expectedCategory }) => {
    const { stage, saved, repo, run } = fixtureLocator(venue);
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    expect(saved).toEqual([{ venueId: venue.id, match: expect.objectContaining({ name: expectedName, category: expectedCategory }) }]);
    expect(repo.traces.map((t) => t.message)).toContain(`Found you on Qloo: ${expectedName}, ${expectedCategory}.`);
    expect(repo.traces.every((t) => t.stage === "locate")).toBe(true);
  });

  it("skips the look-alike record store near The Lantern Room and says so", async () => {
    const { stage, repo, run } = fixtureLocator(venues[1].venue);
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    const messages = repo.traces.map((t) => t.message);
    expect(messages[0]).toBe("Looking for The Lantern Room on Qloo...");
    // The fixture search is fuzzy, like the real one: other "lantern" and "room" places come back too.
    expect(messages[1]).toMatch(/^Skipped 3 look-alikes: .*Lantern Records \(different name\)/);
    expect(messages[2]).toBe("Found you on Qloo: The Lantern Room, cafe.");
  });

  it("names at most three skipped places and counts the rest", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const stage = createLocateStage({
      getVenue: async () => venues[1].venue,
      saveMatch: async () => undefined,
      searchPlaces: async () =>
        found([
          place("1", "Lantern One", ["Cafe"]),
          place("2", "Lantern Two", ["Cafe"]),
          place("3", "Lantern Three", ["Cafe"]),
          place("4", "Lantern Four", ["Cafe"]),
          place("5", "Lantern Five", ["Cafe"]),
        ]),
    });
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    expect(repo.traces[1].message).toBe(
      "Skipped 5 look-alikes: Lantern One (different name), Lantern Two (different name), Lantern Three (different name) and 2 more.",
    );
  });

  it("falls back to reading the neighbourhood when the venue is not in Qloo", async () => {
    const unknown: VenueInput = { id: "v9", name: "Zzyzx Qwerty Parlour", address: "1 Nowhere Rd, Brooklyn, NY", lat: 40.7, lon: -73.9, venueType: "bar" };
    const { stage, saved, repo, run } = fixtureLocator(unknown);
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    expect(saved).toEqual([]);
    const last = repo.traces.at(-1);
    expect(last).toMatchObject({
      level: "warn",
      message: "Your venue isn't in Qloo's catalogue yet; we'll read the neighbourhood instead.",
    });
  });

  it("puts the full parameter set in the trace when Qloo returns nothing at all", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const stage = createLocateStage({
      getVenue: async () => venues[1].venue,
      saveMatch: async () => undefined,
      searchPlaces: async () => ({
        items: [],
        endpoint: "/search",
        params: { query: "The Lantern Room Brooklyn, NY", take: "8", types: "urn:entity:place" },
      }),
    });
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    const empty = repo.traces.find((t) => t.message.startsWith("Qloo returned nothing for your venue name."));
    expect(empty?.level).toBe("warn");
    expect(empty?.message).toContain("query=The Lantern Room Brooklyn, NY, take=8, types=urn:entity:place");
    expect(empty?.data).toEqual({
      endpoint: "/search",
      params: { query: "The Lantern Room Brooklyn, NY", take: "8", types: "urn:entity:place" },
    });
  });

  it("does not add the debug line when Qloo found places but none matched", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const stage = createLocateStage({
      getVenue: async () => venues[1].venue,
      saveMatch: async () => undefined,
      searchPlaces: async () => found([place("m", "The Lantern Room", ["Museum"])]),
    });
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    expect(repo.traces.some((t) => t.message.startsWith("Qloo returned nothing"))).toBe(false);
  });

  it("logs its Qloo call against the run with the locate purpose", async () => {
    const { stage, store, repo, run } = fixtureLocator(venues[1].venue);
    await stage({ run, trace: createTracer(repo, run.id, "locate") });
    expect(store.calls).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({ runId: run.id, purpose: "locate.venue", endpoint: "/search" });
    expect(store.calls[0].params.query).toBe("The Lantern Room Brooklyn, NY");
  });

  it("fails clearly when the venue row is missing", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const stage = createLocateStage({ getVenue: async () => null, saveMatch: async () => undefined, searchPlaces: async () => found([]) });
    await expect(stage({ run, trace: createTracer(repo, run.id, "locate") })).rejects.toThrow(/not found/);
  });

  it("runs inside the runner, and a Qloo failure is skipped instead of stopping the run", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const noop: StageFn = async () => undefined;
    const stages = Object.fromEntries(STAGE_ORDER.map((n) => [n, noop])) as Record<RunnableStage, StageFn>;
    stages.locate = createLocateStage({
      getVenue: async () => venues[0].venue,
      saveMatch: async () => undefined,
      searchPlaces: async () => {
        throw new Error("qloo exploded");
      },
    });
    const { advanceRun } = createRunner({ repo, stages });
    const result = await advanceRun(run.id);
    expect(result).toMatchObject({ ran: "locate", status: "pending", stage: "scout" });
    expect(repo.traces.some((t) => t.level === "error" && t.message.includes("Carrying on without it."))).toBe(true);
  });
});
