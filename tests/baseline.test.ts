import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { BASELINE_SYSTEM, baselinePrompt, baselineSchema, baselineVerdict } from "@/src/agent/baseline/baseline";
import { createBaselineStage } from "@/src/agent/baseline/stage";
import { createLlm } from "@/src/agent/llm";
import { createMemoryLlmStore } from "@/src/agent/llmStore";
import type { ProviderEntry } from "@/src/agent/llmProviders";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createTracer } from "@/src/agent/trace";
import type { PoolSignal } from "@/src/agent/scout/pool";

const signal = (name: string, extra: Partial<PoolSignal> = {}): PoolSignal => ({
  refId: `id_${name}`,
  kind: "entity",
  domain: "movie",
  source: "area",
  name,
  tags: [],
  appearances: {},
  callId: null,
  ...extra,
});

const pool: PoolSignal[] = [
  signal("Spirited Away"),
  signal("Nujabes", { domain: "artist" }),
  signal("Up"),
  signal("Tonkotsu Alley", { domain: "place" }),
  signal("Studio Ghibli", { kind: "tag", domain: null, tagType: "urn:tag:theme:qloo", affinity: 0.9 }),
  signal("Comedy", { kind: "tag", domain: null, tagType: "urn:tag:genre:qloo", affinity: 1 }),
  signal("Dj sets", { kind: "tag", domain: null, tagType: "urn:tag:theme:qloo", source: "venue", affinity: 1 }),
];

describe("baselineVerdict", () => {
  it("counts the ideas that mention something from this area's results", () => {
    const verdict = baselineVerdict(["Spirited Away movie night", "Trivia night with prizes", "Open mic"], pool);
    expect(verdict).toMatchObject({ total: 3, tied: 1, mentions: ["Spirited Away"] });
    expect(verdict.sentence).toBe("LLM only: 3 ideas, 1 of 3 tied to this area's real tastes.");
  });

  it("is 0 of 3 for generic ideas, which is the honest result", () => {
    const verdict = baselineVerdict(["Weekly trivia night", "Open mic night", "Live acoustic music"], pool);
    expect(verdict).toMatchObject({ tied: 0, mentions: [] });
    expect(verdict.sentence).toBe("LLM only: 3 ideas, 0 of 3 tied to this area's real tastes.");
  });

  it("matches whole words only, ignoring case", () => {
    expect(baselineVerdict(["nujabes listening hour"], pool).tied).toBe(1);
    expect(baselineVerdict(["Nujabesque evening"], pool).tied).toBe(0);
  });

  it("ignores names too short to be meaningful, so 'Up' never matches 'pop up'", () => {
    expect(baselineVerdict(["Pop up market, set up early"], pool).tied).toBe(0);
  });

  it("counts a specific theme tag but not a broad genre tag or the venue's own tags", () => {
    expect(baselineVerdict(["A Studio Ghibli night"], pool).tied).toBe(1);
    expect(baselineVerdict(["Stand-up comedy night"], pool).tied).toBe(0);
    expect(baselineVerdict(["Dj sets on Fridays"], pool).tied).toBe(0);
  });

  it("does not count nearby places as tastes", () => {
    expect(baselineVerdict(["Ramen at Tonkotsu Alley"], pool).tied).toBe(0);
  });

  it("handles names with punctuation without breaking the match", () => {
    const odd = [signal("Spider-Man: Into the Spider-Verse (2018)")];
    expect(baselineVerdict(["Watch Spider-Man: Into the Spider-Verse (2018) together"], odd).tied).toBe(1);
  });

  it("says 'idea' for one idea and handles an empty list", () => {
    expect(baselineVerdict(["Open mic"], pool).sentence).toBe("LLM only: 1 idea, 0 of 1 tied to this area's real tastes.");
    expect(baselineVerdict([], pool).total).toBe(0);
  });
});

describe("the baseline question", () => {
  it("asks the plain question with no Qloo data in it", () => {
    const prompt = baselinePrompt({ venueType: "music_venue", address: "100 Crosby St, New York", night: "tuesday" });
    expect(prompt).toBe("Suggest 3 recurring weekly events for a music venue at 100 Crosby St, New York on tuesday. One line each.");
    expect(BASELINE_SYSTEM).toMatch(/know nothing about the neighbourhood/);
  });

  it("asks for exactly three ideas", () => {
    expect(baselineSchema.safeParse({ ideas: ["one idea", "two ideas", "three ideas"] }).success).toBe(true);
    expect(baselineSchema.safeParse({ ideas: ["one idea", "two ideas"] }).success).toBe(false);
  });
});

const provider: ProviderEntry = { name: "google", label: "Gemini", model: () => ({ id: "g", model: {} as unknown as LanguageModel }) };

function stageSetup(mode: "live" | "mock", answers: Array<() => unknown> = []) {
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const trace = createTracer(repo, run.id, "baseline");
  const saved: Array<{ ideas: string[]; sentence: string }> = [];
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
  const stage = createBaselineStage({
    getVenue: async () => ({ id: run.venueId, name: "V", address: "100 Crosby St, New York, NY", lat: 0, lon: 0, venueType: "cafe", slowNight: "tuesday" }),
    loadPool: async () => pool,
    saveBaseline: async (_id, b) => {
      saved.push({ ideas: b.ideas, sentence: b.verdict.sentence });
    },
    generateStructured: llm.generateStructured,
  });
  return { stage, run, trace, saved, prompts, messages: () => repo.traces.map((t) => t.message) };
}

describe("Baseline stage", () => {
  it("asks a real model the plain question and saves its ideas with a code-computed verdict", async () => {
    const { stage, run, trace, saved, prompts, messages } = stageSetup("live", [
      () => ({ ideas: ["Weekly trivia night", "Open mic night", "Nujabes listening hour"] }),
    ]);
    await stage({ run, trace });
    expect(prompts[0]).toBe("Suggest 3 recurring weekly events for a cafe at 100 Crosby St, New York, NY on tuesday. One line each.");
    expect(saved).toEqual([
      { ideas: ["Weekly trivia night", "Open mic night", "Nujabes listening hour"], sentence: "LLM only: 3 ideas, 1 of 3 tied to this area's real tastes." },
    ]);
    expect(messages().at(-1)).toContain("For comparison, a language model with no Qloo data suggested:");
  });

  it("never sends any Qloo result to the model", async () => {
    const { stage, run, trace, prompts } = stageSetup("live", [() => ({ ideas: ["aaaaaa", "bbbbbb", "cccccc"] })]);
    await stage({ run, trace });
    for (const s of pool) expect(prompts[0]).not.toContain(s.name);
  });

  it("saves nothing, and says why, when no model answers, instead of inventing a comparison", async () => {
    const { stage, run, trace, saved, messages } = stageSetup("live", []);
    await stage({ run, trace });
    expect(saved).toEqual([]);
    expect(messages()).toContain("The comparison without Qloo needs a language model and none answered, so it is skipped.");
  });

  it("uses canned ideas in mock mode, for tests and keyless development only", async () => {
    const { stage, run, trace, saved } = stageSetup("mock");
    await stage({ run, trace });
    expect(saved[0].ideas).toHaveLength(3);
  });

  it("does not ask twice for the same run", async () => {
    const { stage, run, trace, prompts } = stageSetup("live", [() => ({ ideas: ["aaaaaa", "bbbbbb", "cccccc"] }), () => ({ ideas: ["x", "y", "z"] })]);
    await stage({ run, trace });
    await stage({ run, trace });
    expect(prompts).toHaveLength(1);
  });
});
