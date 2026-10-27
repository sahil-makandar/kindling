import { describe, expect, it, vi } from "vitest";
import { buildAliasTable, resolveCandidates, standardCandidates, type PoolRef } from "@/src/agent/designer/candidates";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createTracer } from "@/src/agent/trace";
import type { PoolSignal } from "@/src/agent/scout/pool";
import { runDeterministicPlan, ScoutRun, type ScoutVenue } from "@/src/agent/scout/scout";
import { createVerifyStage, MAX_VERIFIED, type ScoredRow, type StoredCandidate } from "@/src/agent/verifier/stage";
import { UserFacingError } from "@/src/lib/errors";
import { createQlooClient } from "@/src/qloo/client";
import { createEndpoints, type Endpoints } from "@/src/qloo/endpoints";
import { QlooError } from "@/src/qloo/errors";
import { createMemoryStore } from "@/src/qloo/store";
import { resetUnsupported } from "@/src/qloo/tags";
import { COMPONENTS } from "@/src/scoring/clubScore";

const VENUE: ScoutVenue = { name: "The Lantern Room", venueType: "cafe", lat: 40.7081, lon: -73.9571, city: "Brooklyn", qlooEntityId: "fx_place_the_lantern_room", tags: [] };

async function poolForVenue(): Promise<PoolSignal[]> {
  const store = createMemoryStore();
  const api = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const scout = new ScoutRun({ venue: VENUE, api, trace: createTracer(repo, run.id, "scout"), runId: run.id });
  await runDeterministicPlan(scout);
  return scout.pool.all();
}

function candidatesFrom(pool: PoolSignal[]): StoredCandidate[] {
  const { aliases, view } = buildAliasTable(pool);
  const { kept } = resolveCandidates(standardCandidates(view, aliases, "cafe", 8), aliases);
  return kept.map((c, i) => ({ id: `cand-${i + 1}`, ...c }));
}

const ref = (id: string, name: string, domain: string, kind: "entity" | "tag" = "entity"): PoolRef => ({ id, name, domain, kind });

type Setup = {
  candidates?: StoredCandidate[];
  api?: Pick<Endpoints, "scoreList" | "insightsHeatmap">;
  maxVerified?: number;
};

async function setup(over: Setup = {}) {
  const pool = await poolForVenue();
  const candidates = over.candidates ?? candidatesFrom(pool);
  const store = createMemoryStore();
  const real = createEndpoints(createQlooClient({ mode: "fixtures", baseUrl: "x", store }).get);
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const trace = createTracer(repo, run.id, "verify");
  const saved: ScoredRow[][] = [];
  const stage = createVerifyStage({
    getVenue: async () => ({ id: run.venueId, name: VENUE.name, address: "1 Test St, Brooklyn, NY", lat: VENUE.lat, lon: VENUE.lon, venueType: VENUE.venueType }),
    loadPool: async () => pool,
    loadCandidates: async () => candidates,
    saveScores: async (_id, rows) => {
      saved.push(rows);
    },
    api: over.api ?? real,
    maxVerified: over.maxVerified,
  });
  return { stage, run, trace, saved, store, candidates, pool, messages: () => repo.traces.map((t) => t.message), traces: repo.traces, real };
}

describe("Verify stage", () => {
  it("scores and ranks every candidate, saving a full breakdown for each", async () => {
    const { stage, run, trace, saved, candidates } = await setup();
    await stage({ run, trace });
    expect(saved).toHaveLength(1);
    const rows = saved[0];
    expect(rows).toHaveLength(candidates.length);
    expect(rows.map((r) => r.rank).sort((a, b) => a - b)).toEqual(candidates.map((_, i) => i + 1));
    for (const row of rows) {
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
      for (const name of COMPONENTS) {
        expect(row.breakdown[name].value).toBeGreaterThanOrEqual(0);
        expect(row.breakdown[name].value).toBeLessThanOrEqual(1);
        expect(row.breakdown[name].reason.length).toBeGreaterThan(10);
      }
    }
    const byRank = [...rows].sort((a, b) => a.rank - b.rank);
    for (let i = 1; i < byRank.length; i++) expect(byRank[i - 1].score).toBeGreaterThanOrEqual(byRank[i].score);
  });

  it("checks only the top few with Qloo, using the anchor as the taste signal", async () => {
    const { stage, run, trace, saved, store } = await setup();
    await stage({ run, trace });
    const coherenceCalls = store.calls.filter((c) => c.purpose === "verify.coherence");
    expect(coherenceCalls.length).toBeGreaterThan(0);
    expect(coherenceCalls.length).toBeLessThanOrEqual(MAX_VERIFIED * 2);
    for (const call of coherenceCalls) {
      expect(call.params["signal.interests.entities"]).toMatch(/^fx_/);
      expect(call.params["filter.results.entities"]).toMatch(/^fx_/);
      expect(call.runId).toBeDefined();
    }
    const verified = saved[0].filter((r) => r.verified);
    expect(verified.length).toBeLessThanOrEqual(MAX_VERIFIED);
    expect(verified.length).toBeGreaterThan(0);
  });

  it("scores the clubs it did not check with the default, and says so", async () => {
    const { stage, run, trace, saved } = await setup({ maxVerified: 2 });
    await stage({ run, trace });
    const unchecked = saved[0].filter((r) => !r.verified);
    expect(unchecked.length).toBeGreaterThan(0);
    for (const row of unchecked) {
      expect(row.breakdown.coherence.flagged).toBe(true);
      expect(row.breakdown.coherence.value).toBeLessThanOrEqual(0.4);
    }
  });

  it("is deterministic: the same inputs give the same scores and ranks", async () => {
    const first = await setup();
    const second = await setup();
    await first.stage({ run: first.run, trace: first.trace });
    await second.stage({ run: second.run, trace: second.trace });
    const strip = (rows: ScoredRow[]) => rows.map(({ id, score, rank, verified }) => ({ id, score, rank, verified }));
    expect(strip(first.saved[0])).toEqual(strip(second.saved[0]));
  });

  it("links each component to the Qloo calls that produced it", async () => {
    const { stage, run, trace, saved, store } = await setup();
    await stage({ run, trace });
    const checked = saved[0].find((r) => r.verified)!;
    expect(checked.breakdown.coherence.callIds.length).toBeGreaterThan(0);
    const logged = new Set(store.calls.map((_, i) => `call-${i + 1}`));
    for (const id of checked.breakdown.coherence.callIds) expect(logged.has(id)).toBe(true);
    expect(checked.breakdown.localAffinity.callIds.length).toBe(1);
  });

  it("counts a companion Qloo did not rank as low, and still verifies the club", async () => {
    // Parasite shares no tags with Spirited Away in the sample data, so Qloo leaves it out, like the real API would.
    const candidate: StoredCandidate = {
      id: "only",
      title: "Ghibli and a stranger",
      anchor: ref("fx_spirited_away", "Spirited Away", "movie"),
      companions: [ref("fx_my_neighbor_totoro", "My Neighbor Totoro", "movie"), ref("fx_nujabes", "Nujabes", "artist"), ref("fx_parasite", "Parasite", "movie")],
      format: "discussion_club",
      why: "Spirited Away",
    };
    const { stage, run, trace, saved } = await setup({ candidates: [candidate] });
    await stage({ run, trace });
    expect(saved[0]).toHaveLength(1);
    expect(saved[0][0].breakdown.coherence.reason).toContain("Parasite not ranked by Qloo");
  });

  it("judges tag companions by the anchor's own tags and asks Qloo nothing about places or tags", async () => {
    const candidate: StoredCandidate = {
      id: "tags",
      title: "Anime and ramen",
      anchor: ref("fx_spirited_away", "Spirited Away", "movie"),
      companions: [ref("fx_tag_animation", "Animation", "tag", "tag"), ref("fx_place_tonkotsu_alley", "Tonkotsu Alley", "place")],
      format: "tasting",
      why: "Spirited Away",
    };
    const { stage, run, trace, saved, store } = await setup({ candidates: [candidate] });
    await stage({ run, trace });
    expect(store.calls.filter((c) => c.purpose === "verify.coherence")).toHaveLength(0);
    expect(saved[0][0].breakdown.coherence.value).toBeGreaterThan(0.3);
  });

  it("keeps going when Qloo fails for a club, leaves it on the default and says so", async () => {
    const real = (await setup()).real;
    const api: Pick<Endpoints, "scoreList" | "insightsHeatmap"> = {
      scoreList: vi.fn(async () => {
        throw new QlooError("Qloo took too long to answer.", 0);
      }),
      insightsHeatmap: real.insightsHeatmap,
    };
    const { stage, run, trace, saved, messages } = await setup({ api });
    await stage({ run, trace });
    expect(messages().some((m) => m.startsWith("Could not check ") && m.endsWith("with Qloo: Qloo took too long to answer."))).toBe(true);
    expect(saved[0].every((r) => !r.verified)).toBe(true);
    expect(saved[0].every((r) => r.breakdown.coherence.flagged)).toBe(true);
  });

  it("does not hide real bugs", async () => {
    const real = (await setup()).real;
    const api: Pick<Endpoints, "scoreList" | "insightsHeatmap"> = {
      scoreList: vi.fn(async () => {
        throw new TypeError("bug");
      }),
      insightsHeatmap: real.insightsHeatmap,
    };
    const { stage, run, trace } = await setup({ api });
    await expect(stage({ run, trace })).rejects.toThrow("bug");
  });

  it("adds a heat layer to the best club only, from Qloo's heatmap", async () => {
    const { stage, run, trace, saved, store } = await setup();
    await stage({ run, trace });
    const withHeat = saved[0].filter((r) => r.breakdown.heat);
    expect(withHeat).toHaveLength(1);
    expect(withHeat[0].rank).toBe(1);
    expect(withHeat[0].breakdown.heat?.source).toBe("qloo_heatmap");
    expect(withHeat[0].breakdown.heat?.points.length).toBeGreaterThan(0);
    expect(withHeat[0].breakdown.heat?.points.length).toBeLessThanOrEqual(60);
    expect(store.calls.filter((c) => c.purpose === "verify.heatmap")).toHaveLength(1);
  });

  it("falls back to nearby places for the heat layer when Qloo has no heatmap", async () => {
    resetUnsupported();
    const real = (await setup()).real;
    const api: Pick<Endpoints, "scoreList" | "insightsHeatmap"> = {
      scoreList: real.scoreList,
      insightsHeatmap: vi.fn(async () => {
        throw new QlooError("Qloo does not allow this kind of request with our key (status 403).", 403);
      }),
    };
    const { stage, run, trace, saved, messages } = await setup({ api });
    await stage({ run, trace });
    const heat = saved[0].find((r) => r.breakdown.heat)?.breakdown.heat;
    expect(heat?.source).toBe("nearby_places");
    expect(messages().some((m) => m.includes("Showing nearby places instead"))).toBe(true);
    resetUnsupported();
  });

  it("writes plain trace lines for the check and the winners", async () => {
    const { stage, run, trace, messages } = await setup();
    await stage({ run, trace });
    const lines = messages();
    expect(lines[0]).toMatch(/^Checking \d of the \d+ clubs with Qloo: do the companions really go with the anchor\?/);
    expect(lines.some((m) => m.startsWith("Checking whether fans of "))).toBe(true);
    expect(lines.filter((m) => m.startsWith("Number "))).toHaveLength(3);
    expect(lines.find((m) => m.startsWith("Number 1: "))).toMatch(/^Number 1: .+, score \d+(\.\d)?( \(not checked with Qloo\))?\.$/);
  });

  it("puts a club anchored on a tag through without a heat layer or a Qloo check", async () => {
    const candidate: StoredCandidate = {
      id: "tag-anchor",
      title: "Drama night",
      anchor: ref("fx_tag_drama", "Drama", "tag", "tag"),
      companions: [ref("fx_nujabes", "Nujabes", "artist")],
      format: "discussion_club",
      why: "Drama",
    };
    const { stage, run, trace, saved, store } = await setup({ candidates: [candidate] });
    await stage({ run, trace });
    expect(saved[0][0].breakdown.heat).toBeUndefined();
    expect(store.calls.filter((c) => c.purpose === "verify.coherence")).toHaveLength(0);
    expect(saved[0][0].breakdown.sweetSpot.flagged).toBe(true);
  });

  it("stops with a plain message when there is nothing to check", async () => {
    const { stage, run, trace } = await setup({ candidates: [] });
    await expect(stage({ run, trace })).rejects.toThrow(UserFacingError);
    await expect(stage({ run, trace })).rejects.toThrow("no club ideas to check");
  });

  it("uses the venue type to score format fit and venue fit", async () => {
    const { stage, run, trace, saved } = await setup();
    await stage({ run, trace });
    const discussion = saved[0].find((r) => r.breakdown.formatFit.reason.startsWith("A discussion club suits a cafe at 90"));
    expect(discussion).toBeDefined();
    expect(saved[0].some((r) => r.breakdown.venueFit.reason.includes("what a cafe leans on most"))).toBe(true);
  });
});
