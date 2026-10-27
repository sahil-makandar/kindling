import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildAliasTable,
  CLUB_FORMATS,
  MAX_CANDIDATES,
  MIN_CANDIDATES,
  plain,
  resolveCandidates,
  shortName,
  standardCandidates,
  type ClubCandidate,
  type RawCandidate,
} from "@/src/agent/designer/candidates";
import { createDesignStage } from "@/src/agent/designer/stage";
import { createLlm } from "@/src/agent/llm";
import { createMemoryLlmStore } from "@/src/agent/llmStore";
import type { ProviderEntry } from "@/src/agent/llmProviders";
import { DESIGNER_SYSTEM, designerPrompt } from "@/src/agent/prompts/designer";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createTracer } from "@/src/agent/trace";
import type { PoolSignal } from "@/src/agent/scout/pool";
import { runDeterministicPlan, ScoutRun, type ScoutVenue } from "@/src/agent/scout/scout";
import { UserFacingError } from "@/src/lib/errors";
import { createQlooClient } from "@/src/qloo/client";
import { createEndpoints } from "@/src/qloo/endpoints";
import { createMemoryStore } from "@/src/qloo/store";

const VENUES: Record<string, ScoutVenue> = {
  soho: { name: "Crosby Street Coffee", venueType: "cafe", lat: 40.7246, lon: -73.9973, city: "New York", qlooEntityId: null, tags: [] },
  williamsburg: { name: "The Lantern Room", venueType: "cafe", lat: 40.7081, lon: -73.9571, city: "Brooklyn", qlooEntityId: "fx_place_the_lantern_room", tags: [] },
  east_austin: { name: "East Side Roasters", venueType: "cafe", lat: 30.263, lon: -97.723, city: "Austin", qlooEntityId: null, tags: [] },
  logan_square: { name: "The Page Turner Cafe", venueType: "bar", lat: 41.9296, lon: -87.7083, city: "Chicago", qlooEntityId: null, tags: [] },
};

// A realistic pool: what the Scout's standard plan finds in the fixtures.
async function poolFor(key: string, venueType?: string): Promise<PoolSignal[]> {
  const venue = { ...VENUES[key], ...(venueType ? { venueType } : {}) };
  const store = createMemoryStore();
  const api = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const scout = new ScoutRun({ venue, api, trace: createTracer(repo, run.id, "scout"), runId: run.id });
  await runDeterministicPlan(scout);
  return scout.pool.all();
}

const raw = (over: Partial<RawCandidate> = {}): RawCandidate => ({
  title: "Spirited Away Club",
  anchor: "m1",
  companions: ["a1"],
  format: "discussion_club",
  why: "Spirited Away leads film here and pairs with music.",
  ...over,
});

describe("buildAliasTable", () => {
  it("gives every signal a short alias and a view the model can read", async () => {
    const pool = await poolFor("williamsburg");
    const { aliases, view } = buildAliasTable(pool);
    expect(view.domains.map((d) => d.domain)).toEqual(["artist", "movie", "tv_show", "book", "podcast"]);
    expect(aliases.get("m1")?.domain).toBe("movie");
    expect(aliases.get("a1")?.domain).toBe("artist");
    expect(aliases.get("l1")?.domain).toBe("place");
    expect(view.places.length).toBeGreaterThan(3);
    for (const { items } of view.domains) expect(items.length).toBeLessThanOrEqual(11);
    // Aliases are unique and short.
    expect(new Set(aliases.keys()).size).toBe(aliases.size);
    for (const alias of aliases.keys()) expect(alias).toMatch(/^[a-z]\d+$/);
  });

  it("shows distinctive picks before household names, and caps the household names", async () => {
    const pool = await poolFor("soho");
    const { view } = buildAliasTable(pool);
    for (const { items } of view.domains) {
      const known = items.filter((i) => (i.popularity ?? 0) > 0.9);
      expect(known.length).toBeLessThanOrEqual(3);
      const firstKnown = items.findIndex((i) => (i.popularity ?? 0) > 0.9);
      if (firstKnown >= 0) expect(items.slice(firstKnown).every((i) => (i.popularity ?? 0) > 0.9)).toBe(true);
    }
  });

  it("keeps Qloo ids out of what the model sees", async () => {
    const pool = await poolFor("williamsburg");
    const { view } = buildAliasTable(pool);
    const text = designerPrompt({ venueName: "The Lantern Room", venueType: "cafe", city: "Brooklyn", slowNight: "tuesday", view });
    for (const signal of pool) expect(text).not.toContain(signal.refId);
    expect(text).toContain("Venue: The Lantern Room, a cafe in Brooklyn. Its quietest night is tuesday.");
    expect(text).toMatch(/^ {2}m1 \| /m);
  });

  it("marks rising picks and separates genre tags from vibe tags", async () => {
    const pool = await poolFor("soho");
    const { view } = buildAliasTable(pool);
    expect(view.domains.some((d) => d.items.some((i) => i.rising))).toBe(true);
    expect(view.themeTags.length).toBeGreaterThan(0);
    expect(view.themeTags.every((t) => /^g\d+$/.test(t.alias))).toBe(true);
  });
});

describe("resolveCandidates", () => {
  it("builds clubs from pool signals and takes names and ids from the pool, not from the model", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept, dropped } = resolveCandidates([raw()], aliases);
    expect(dropped).toEqual([]);
    expect(kept[0].anchor).toEqual({
      id: aliases.get("m1")!.refId,
      kind: "entity",
      domain: "movie",
      name: aliases.get("m1")!.name,
    });
    expect(kept[0].companions[0].id).toBe(aliases.get("a1")!.refId);
  });

  it("drops a club that cites something that is not in the pool, with a plain reason", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept, dropped } = resolveCandidates(
      [raw({ anchor: "m99" }), raw({ title: "Ghost companion", companions: ["x7"] }), raw({ title: "Fine one", anchor: "b1", companions: ["m1"] })],
      aliases,
    );
    expect(kept.map((c) => c.title)).toEqual(["Fine one"]);
    expect(dropped).toEqual([
      { title: "Spirited Away Club", reason: "it used something that Qloo never returned for this area" },
      { title: "Ghost companion", reason: "it used something that Qloo never returned for this area" },
    ]);
  });

  it("drops a club whose companions come from the same domain as the anchor", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept, dropped } = resolveCandidates([raw({ anchor: "m1", companions: ["m2", "m3"] })], aliases);
    expect(kept).toEqual([]);
    expect(dropped[0].reason).toBe("its companions must come from a different domain than the anchor");
  });

  it("keeps only the cross-domain companions when some are the same domain", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept } = resolveCandidates([raw({ anchor: "m1", companions: ["m2", "a1"] })], aliases);
    expect(kept[0].companions.map((c) => c.domain)).toEqual(["artist"]);
  });

  it("allows places and tags as companions", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept } = resolveCandidates([raw({ companions: ["l1", "g1"] })], aliases);
    expect(kept[0].companions.map((c) => c.domain)).toEqual(["place", "tag"]);
  });

  it("drops a second club that uses the same anchor", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept, dropped } = resolveCandidates([raw(), raw({ title: "Again", companions: ["b1"] })], aliases);
    expect(kept).toHaveLength(1);
    expect(dropped[0].reason).toBe("another idea already uses the same anchor");
  });

  it("does not let an anchor be its own companion", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept, dropped } = resolveCandidates([raw({ companions: ["m1"] })], aliases);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(1);
  });

  it("limits the title to six words and replaces dashes", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const dash = String.fromCharCode(0x2014);
    const anchorName = aliases.get("m1")!.name;
    const { kept } = resolveCandidates(
      [raw({ title: `One two three four five six seven eight`, why: `${anchorName} ${dash} a favourite here` })],
      aliases,
    );
    expect(kept[0].title).toBe("One two three four five six");
    expect(kept[0].why).toBe(`${anchorName} - a favourite here`);
  });

  it("rewrites a why that does not name the anchor", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const { kept } = resolveCandidates([raw({ why: "It just feels right for a Tuesday." })], aliases);
    expect(kept[0].why).toContain(kept[0].anchor.name);
    expect(kept[0].why).toContain(kept[0].companions[0].name);
  });

  it("keeps at most eight clubs", async () => {
    const { aliases } = buildAliasTable(await poolFor("williamsburg"));
    const anchors = [...aliases.keys()].filter((k) => /^[mtbp]/.test(k)).slice(0, 10);
    expect(anchors.length).toBe(10);
    const many = anchors.map((anchor, i) =>
      raw({ title: `Club ${i}`, anchor, companions: ["a1"], why: aliases.get(anchor)!.name }),
    );
    expect(resolveCandidates(many, aliases).kept).toHaveLength(MAX_CANDIDATES);
  });
});

describe("standardCandidates", () => {
  it.each(Object.keys(VENUES))("proposes enough valid clubs for %s", async (key) => {
    const pool = await poolFor(key);
    const { aliases, view } = buildAliasTable(pool);
    const clubs = standardCandidates(view, aliases, VENUES[key].venueType, MAX_CANDIDATES);
    const { kept, dropped } = resolveCandidates(clubs, aliases);
    expect(dropped).toEqual([]);
    expect(kept.length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
    expect(new Set(kept.map((c) => c.anchor.id)).size).toBe(kept.length);
    for (const c of kept) {
      expect(CLUB_FORMATS).toContain(c.format);
      expect(c.companions.length).toBeGreaterThan(0);
      expect(c.companions.every((x) => x.domain !== c.anchor.domain)).toBe(true);
      expect(c.title).not.toMatch(/[–—]/);
    }
  });

  it("leads with the venue type's most relevant domain and format", async () => {
    const bookstore = buildAliasTable(await poolFor("soho", "bookstore"));
    const first = resolveCandidates(standardCandidates(bookstore.view, bookstore.aliases, "bookstore", 4), bookstore.aliases).kept[0];
    expect(first.anchor.domain).toBe("book");
    expect(first.format).toBe("book_club");
  });

  it("proposes trivia for TV at a bar", async () => {
    const bar = buildAliasTable(await poolFor("soho", "bar"));
    const clubs = resolveCandidates(standardCandidates(bar.view, bar.aliases, "bar", 8), bar.aliases).kept;
    expect(clubs.find((c) => c.anchor.domain === "tv_show")?.format).toBe("trivia_night");
  });

  it("skips anchors that are already taken", async () => {
    const { aliases, view } = buildAliasTable(await poolFor("williamsburg"));
    const first = resolveCandidates(standardCandidates(view, aliases, "cafe", 3), aliases).kept;
    const used = new Set(first.map((c) => c.anchor.id));
    const more = resolveCandidates(standardCandidates(view, aliases, "cafe", 3, used), aliases).kept;
    expect(more.every((c) => !used.has(c.anchor.id))).toBe(true);
  });

  it("only claims what the pool shows: shared tags named in the why are real", async () => {
    const { aliases, view } = buildAliasTable(await poolFor("williamsburg"));
    const clubs = standardCandidates(view, aliases, "cafe", 8);
    for (const club of clubs) {
      const m = /because they share (.+?)\.$/.exec(club.why);
      if (!m) continue;
      const anchorTags = aliases.get(club.anchor)!.tags.map((t) => t.name.toLowerCase());
      for (const tag of m[1].split(" and ")) expect(anchorTags).toContain(tag.toLowerCase());
    }
  });
});

describe("helpers and the prompt", () => {
  it("shortens long titles at a colon or bracket", () => {
    expect(shortName("Daytime Revolution: the film")).toBe("Daytime Revolution");
    expect(shortName("More Than Enough: Claiming Space for Who You Are")).toBe("More Than Enough");
    expect(shortName("A Very Long Title With Many Words")).toBe("A Very Long");
    expect(plain("  a   b ")).toBe("a b");
  });

  it("forbids full-film screenings and lists every format", () => {
    expect(DESIGNER_SYSTEM).toMatch(/Never propose screening a full film/);
    for (const format of CLUB_FORMATS) expect(DESIGNER_SYSTEM).toContain(format);
    expect(DESIGNER_SYSTEM).toMatch(/Do not use em dashes/);
    expect(DESIGNER_SYSTEM).toMatch(/6 to 8 clubs/);
  });
});

// ---------------------------------------------------------------- the stage

const provider: ProviderEntry = { name: "google", label: "Gemini", model: () => ({ id: "g", model: {} as unknown as LanguageModel }) };

async function stageFor(key: string, answers: Array<() => unknown>, mode: "live" | "mock" = "live") {
  const pool = await poolFor(key);
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const trace = createTracer(repo, run.id, "design");
  const saved: ClubCandidate[][] = [];
  const prompts: string[] = [];
  const queue = [...answers];
  const llm = createLlm({
    mode,
    providers: [provider],
    store: createMemoryLlmStore(),
    sleep: async () => undefined,
    callStructured: async ({ prompt }) => {
      prompts.push(prompt);
      const next = queue.shift();
      if (!next) throw new Error("out of answers");
      return next();
    },
  });
  const venue = VENUES[key];
  const stage = createDesignStage({
    getVenue: async () => ({ id: run.venueId, name: venue.name, address: `1 Test St, ${venue.city}, XX`, lat: venue.lat, lon: venue.lon, venueType: venue.venueType, slowNight: "tuesday" }),
    loadPool: async () => pool,
    saveCandidates: async (_id, list) => {
      saved.push(list);
    },
    generateStructured: llm.generateStructured,
  });
  return { stage, run, trace, saved, prompts, messages: () => repo.traces.map((t) => t.message), traces: repo.traces };
}

// Anchors that exist in the pool (the model sees at most 6 films here), each paired with the first artist.
const ANCHORS = ["m1", "b1", "t1", "p1", "m2", "b2", "t2", "p2"];
const good = (n: number) => ({
  candidates: Array.from({ length: n }, (_, i) => ({
    title: `Club number ${i + 1}`,
    anchor: ANCHORS[i],
    companions: ["a1"],
    format: "discussion_club" as const,
    why: `Anchor ${i + 1}`,
  })),
});

describe("Design stage", () => {
  it("in mock mode designs 6 to 8 clubs from the standard plan and saves them", async () => {
    const { stage, run, trace, saved, messages } = await stageFor("williamsburg", [], "mock");
    await stage({ run, trace });
    expect(saved).toHaveLength(1);
    expect(saved[0].length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
    expect(saved[0].length).toBeLessThanOrEqual(MAX_CANDIDATES);
    expect(messages().at(-1)).toMatch(/^Designed \d hidden clubs: /);
  });

  it("uses the model's clubs, saved with real pool references", async () => {
    const { stage, run, trace, saved } = await stageFor("williamsburg", [() => good(7)]);
    await stage({ run, trace });
    expect(saved[0]).toHaveLength(7);
    expect(saved[0][0].title).toBe("Club number 1");
    expect(saved[0][0].anchor.domain).toBe("movie");
    expect(saved[0][0].anchor.id).toMatch(/^fx_/);
    expect(saved[0].every((c) => c.why.length > 5)).toBe(true);
  });

  it("drops a club with an invented id, says so, and tops up from the standard plan", async () => {
    const answer = good(5);
    answer.candidates[2].anchor = "m99";
    const { stage, run, trace, saved, messages } = await stageFor("williamsburg", [() => answer]);
    await stage({ run, trace });
    expect(messages()).toContain('Dropped "Club number 3": it used something that Qloo never returned for this area.');
    expect(messages().some((m) => m.startsWith("Added 2 ideas from the standard plan so there are enough to compare."))).toBe(true);
    expect(saved[0]).toHaveLength(MIN_CANDIDATES);
    expect(new Set(saved[0].map((c) => c.anchor.id)).size).toBe(saved[0].length);
  });

  it("sends an answer where almost nothing resolves back once, with the reason, and then uses the better one", async () => {
    const bad = good(4);
    for (const c of bad.candidates) c.anchor = "m99";
    const { stage, run, trace, saved, prompts } = await stageFor("williamsburg", [() => bad, () => good(6)]);
    await stage({ run, trace });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Only 0 of your 4 clubs were usable");
    expect(saved[0]).toHaveLength(6);
  });

  it("falls back to the standard plan when the model keeps giving unusable answers, and says so", async () => {
    const bad = () => {
      const answer = good(4);
      for (const c of answer.candidates) c.anchor = "m99";
      return answer;
    };
    const { stage, run, trace, saved, messages } = await stageFor("williamsburg", [bad, bad]);
    await stage({ run, trace });
    expect(messages()).toContain("The language model is busy, using the standard plan.");
    expect(saved[0].length).toBeGreaterThanOrEqual(MIN_CANDIDATES);
  });

  it("stops with a plain message when the Scout found too little to design from", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const llm = createLlm({ mode: "mock", providers: [], store: createMemoryLlmStore() });
    const stage = createDesignStage({
      getVenue: async () => ({ id: run.venueId, name: "V", address: "1 St, X", lat: 0, lon: 0, venueType: "cafe" }),
      loadPool: async () => [],
      saveCandidates: async () => undefined,
      generateStructured: llm.generateStructured,
    });
    await expect(stage({ run, trace: createTracer(repo, run.id, "design") })).rejects.toThrow(UserFacingError);
    await expect(stage({ run, trace: createTracer(repo, run.id, "design") })).rejects.toThrow("did not find enough taste signals");
  });

  it("fails clearly when the venue row is missing", async () => {
    const repo = createMemoryRunRepo();
    const run = repo.addRun();
    const stage = createDesignStage({
      getVenue: async () => null,
      loadPool: async () => [],
      saveCandidates: async () => undefined,
      generateStructured: createLlm({ mode: "mock", providers: [], store: createMemoryLlmStore() }).generateStructured,
    });
    await expect(stage({ run, trace: createTracer(repo, run.id, "design") })).rejects.toThrow(/not found/);
  });

  it("asks the main model once and caches the answer for the run", async () => {
    const { stage, run, trace, prompts } = await stageFor("williamsburg", [() => good(6), () => good(6)]);
    await stage({ run, trace });
    await stage({ run, trace });
    expect(prompts).toHaveLength(1);
  });
});
