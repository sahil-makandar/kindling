import { APICallError } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlm, type LlmDeps } from "@/src/agent/llm";
import { createMemoryLlmStore } from "@/src/agent/llmStore";
import { resolveProviders, type ProviderEntry } from "@/src/agent/llmProviders";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import { createTracer } from "@/src/agent/trace";
import { parseEnv } from "@/src/config/env";

const schema = z.object({ title: z.string(), ids: z.array(z.string()) });
type Answer = z.infer<typeof schema>;
const good: Answer = { title: "Ghibli night", ids: ["a"] };

// By default both tiers share one model, so a provider failing means moving to the next provider. quicker gives the
// fast tier its own model, which is what a main-tier question tries next.
function provider(name: "google" | "groq", label: string, quicker = false): ProviderEntry {
  return {
    name,
    label,
    model: (tier) => {
      const id = quicker ? `${name}-${tier}` : `${name}-main`;
      return { id, model: { modelId: id } as unknown as LanguageModel };
    },
  };
}

const apiError = (statusCode: number) =>
  new APICallError({ message: `status ${statusCode}`, url: "https://x.test", requestBodyValues: {}, statusCode });

type Call = { model: string; prompt: string };

function setup(responses: Array<() => unknown>, over: Partial<LlmDeps> = {}) {
  const store = createMemoryLlmStore();
  const repo = createMemoryRunRepo();
  const run = repo.addRun();
  const trace = createTracer(repo, run.id, "design");
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const queue = [...responses];
  const llm = createLlm({
    mode: "live",
    providers: [provider("google", "Gemini"), provider("groq", "Groq")],
    store,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    callStructured: async ({ model, prompt }) => {
      calls.push({ model: (model as unknown as { modelId: string }).modelId, prompt });
      const next = queue.shift();
      if (!next) throw new Error("test ran out of responses");
      return next();
    },
    ...over,
  });
  const options = (extra: Record<string, unknown> = {}) => ({
    runId: run.id,
    cacheKey: "design",
    tier: "main" as const,
    fallback: () => ({ title: "Standard plan", ids: [] }),
    mock: () => ({ title: "Canned", ids: [] }),
    trace,
    ...extra,
  });
  return { llm, store, repo, run, sleeps, calls, options };
}

const warnings = (repo: ReturnType<typeof createMemoryRunRepo>) => repo.traces.filter((t) => t.level === "warn").map((t) => t.message);

describe("generateStructured: mock mode", () => {
  it("returns the canned answer and never touches a provider", async () => {
    const { llm, calls, options } = setup([], { mode: "mock" });
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toEqual({ output: { title: "Canned", ids: [] }, source: "mock" });
    expect(calls).toHaveLength(0);
  });

  it("rejects a canned answer that does not match the schema", async () => {
    const { llm, options } = setup([], { mode: "mock" });
    await expect(llm.generateStructured(schema, "p", options({ mock: () => ({ nope: 1 }) }))).rejects.toThrow();
  });
});

describe("generateStructured: live", () => {
  it("answers from the main provider, counts the call and caches the answer", async () => {
    const { llm, store, calls, run, options } = setup([() => good]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toMatchObject({ output: good, source: "llm", provider: "google", model: "google-main" });
    expect(calls).toEqual([{ model: "google-main", prompt: "p" }]);
    expect(store.calls.get(run.id)).toBe(1);
    expect(store.cache.size).toBe(1);
  });

  it("answers a repeat from the cache with no model call and no extra count", async () => {
    const { llm, store, calls, run, options } = setup([() => good]);
    await llm.generateStructured(schema, "p", options());
    const again = await llm.generateStructured(schema, "p", options());
    expect(again).toMatchObject({ output: good, source: "cache", provider: "google" });
    expect(calls).toHaveLength(1);
    expect(store.calls.get(run.id)).toBe(1);
  });

  it("ignores a cached answer that no longer matches the schema", async () => {
    const { llm, store, run, options, calls } = setup([() => good]);
    await store.set(run.id, "design", { output: { old: "shape" }, provider: "google", model: "m" });
    const result = await llm.generateStructured(schema, "p", options());
    expect(result.source).toBe("llm");
    expect(calls).toHaveLength(1);
  });

  it("uses the fast model for the fast tier", async () => {
    const { llm, calls, options } = setup([() => good]);
    await llm.generateStructured(schema, "p", options({ tier: "fast" }));
    expect(calls[0].model).toBe("google-main");
  });
});

describe("retry on a rejected answer", () => {
  it("asks once more with the reason attached when the answer does not match the schema", async () => {
    const { llm, calls, store, run, options } = setup([() => ({ title: 5 }), () => good]);
    const result = await llm.generateStructured(schema, "Make a club.", options());
    expect(result.output).toEqual(good);
    expect(calls).toHaveLength(2);
    expect(calls[0].prompt).toBe("Make a club.");
    expect(calls[1].prompt).toContain("Make a club.");
    expect(calls[1].prompt).toContain("Your previous answer was rejected");
    expect(store.calls.get(run.id)).toBe(2);
  });

  it("treats a failed domain check the same way, quoting the check's message", async () => {
    const check = (value: Answer) => {
      if (value.ids.includes("ghost")) throw new Error("id ghost is not in the signal pool");
    };
    const { llm, calls, options } = setup([() => ({ title: "x", ids: ["ghost"] }), () => good]);
    const result = await llm.generateStructured(schema, "p", options({ check }));
    expect(result.output).toEqual(good);
    expect(calls[1].prompt).toContain("id ghost is not in the signal pool");
  });

  it("gives up on a provider after one retry and moves to the next", async () => {
    const { llm, calls, repo, options } = setup([() => ({ bad: 1 }), () => ({ bad: 2 }), () => good]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toMatchObject({ source: "llm", provider: "groq", model: "groq-main" });
    expect(calls.map((c) => c.model)).toEqual(["google-main", "google-main", "groq-main"]);
    expect(warnings(repo)).toEqual(["Gemini gave an answer we could not use. Trying Groq."]);
  });
});

describe("rate limits", () => {
  it("backs off 2 s and then 6 s on a 429, then succeeds", async () => {
    const { llm, sleeps, calls, store, run, options } = setup([
      () => {
        throw apiError(429);
      },
      () => {
        throw apiError(429);
      },
      () => good,
    ]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result.source).toBe("llm");
    expect(sleeps).toEqual([2000, 6000]);
    expect(calls).toHaveLength(3);
    expect(store.calls.get(run.id)).toBe(3);
  });

  it("treats 503 high demand like a rate limit", async () => {
    const { llm, sleeps, options } = setup([
      () => {
        throw apiError(503);
      },
      () => good,
    ]);
    expect((await llm.generateStructured(schema, "p", options())).source).toBe("llm");
    expect(sleeps).toEqual([2000]);
  });

  it("moves to the fallback provider after the third 429", async () => {
    const busy = () => {
      throw apiError(429);
    };
    const { llm, calls, repo, options } = setup([busy, busy, busy, () => good]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toMatchObject({ source: "llm", provider: "groq" });
    expect(calls.map((c) => c.model)).toEqual(["google-main", "google-main", "google-main", "groq-main"]);
    expect(warnings(repo)).toEqual(["Gemini is busy. Trying Groq."]);
  });

  it("goes straight to the next provider when a key is rejected, without backing off", async () => {
    const { llm, sleeps, calls, repo, options } = setup([
      () => {
        throw apiError(401);
      },
      () => good,
    ]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result.provider).toBe("groq");
    expect(sleeps).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(warnings(repo)[0]).toBe("Gemini did not accept our key. Trying Groq.");
  });
});

describe("deterministic fallback", () => {
  it("uses the caller's plan and says so when every provider fails", async () => {
    const busy = () => {
      throw apiError(429);
    };
    const { llm, repo, store, options } = setup([busy, busy, busy, busy, busy, busy]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toEqual({ output: { title: "Standard plan", ids: [] }, source: "fallback" });
    expect(warnings(repo).at(-1)).toBe("The language model is busy, using the standard plan.");
    expect(store.cache.size).toBe(0);
  });

  it("falls back when no provider is configured", async () => {
    const { llm, options } = setup([], { providers: [] });
    expect((await llm.generateStructured(schema, "p", options())).source).toBe("fallback");
  });

  it("skips a provider with no model for the tier and says so", async () => {
    const noModel: ProviderEntry = { name: "groq", label: "Groq", model: () => null };
    const { llm, repo, options } = setup([], { providers: [noModel] });
    const result = await llm.generateStructured(schema, "p", options());
    expect(result.source).toBe("fallback");
    expect(warnings(repo)[0]).toBe("Groq no model is set for Groq.");
  });

  it("treats a network failure like any other provider failure and keeps the detail for debugging", async () => {
    const { llm, repo, options } = setup([
      () => {
        throw new TypeError("fetch failed: ECONNRESET");
      },
      () => good,
    ]);
    const result = await llm.generateStructured(schema, "p", options());
    expect(result.provider).toBe("groq");
    expect(warnings(repo)).toEqual(["Gemini failed. Trying Groq."]);
    const line = repo.traces.find((t) => t.level === "warn");
    expect(JSON.stringify(line?.data)).toContain("ECONNRESET");
  });

  it("never puts raw error text in the trace message", async () => {
    const { llm, repo, options } = setup([
      () => {
        throw new Error("secret internal detail");
      },
      () => {
        throw new Error("secret internal detail");
      },
    ]);
    await llm.generateStructured(schema, "p", options());
    expect(warnings(repo).join(" ")).not.toContain("secret internal detail");
  });
});

describe("time budget", () => {
  it("stops waiting when the budget runs out and uses the next provider", async () => {
    const slow = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            const e = new Error("aborted");
            e.name = "TimeoutError";
            reject(e);
          }, 20);
        }),
    );
    const { llm, calls, repo, options } = setup([slow, () => good], { budgetMs: 1000 });
    const result = await llm.generateStructured(schema, "p", options());
    expect(result.provider).toBe("groq");
    expect(calls).toHaveLength(2);
    expect(warnings(repo)[0]).toBe("Gemini took too long. Trying Groq.");
  });

  it("does not start a backoff that would run past the budget", async () => {
    const busy = () => {
      throw apiError(429);
    };
    const { llm, sleeps, options } = setup([busy, () => good], { budgetMs: 1500 });
    const result = await llm.generateStructured(schema, "p", options());
    expect(sleeps).toEqual([]);
    expect(result.provider).toBe("groq");
  });
});

describe("runToolLoop", () => {
  const tools = {} as ToolSet;
  const loopOptions = (fallback: () => Promise<void>, trace?: ReturnType<typeof createTracer>, runId = "r") => ({
    runId,
    tier: "fast" as const,
    prompt: "scout",
    maxSteps: 8,
    fallback,
    trace,
  });

  it("runs the deterministic plan in mock mode", async () => {
    const fallback = vi.fn(async () => undefined);
    const { llm } = setup([], { mode: "mock" });
    expect(await llm.runToolLoop(tools, "sys", loopOptions(fallback))).toEqual({ source: "mock", steps: 0 });
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("lets the model run the loop and counts each step", async () => {
    const fallback = vi.fn(async () => undefined);
    const { llm, store, run } = setup([], {
      callLoop: async ({ onStep }) => {
        onStep({ ms: 1, toolCalls: 1 });
        onStep({ ms: 1, toolCalls: 1 });
        onStep({ ms: 1, toolCalls: 1 });
        return { steps: 3 };
      },
    });
    const result = await llm.runToolLoop(tools, "sys", loopOptions(fallback, undefined, run.id));
    expect(result).toMatchObject({ source: "llm", steps: 3, provider: "google", model: "google-main" });
    expect(fallback).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(store.calls.get(run.id)).toBe(3);
  });

  it("limits each step as well as the whole loop", async () => {
    const seen: number[] = [];
    const { llm } = setup([], {
      callLoop: async ({ stepMs, onStep }) => {
        seen.push(stepMs);
        onStep({ ms: 1, toolCalls: 1 });
        return { steps: 1 };
      },
    });
    await llm.runToolLoop(tools, "sys", { ...loopOptions(vi.fn(async () => undefined)), stepMs: 9000 });
    await llm.runToolLoop(tools, "sys", loopOptions(vi.fn(async () => undefined)));
    expect(seen).toEqual([9000, 15000]);
  });

  it("tries the next provider when the first fails before doing anything", async () => {
    const used: string[] = [];
    const { llm, repo, run } = setup([], {
      callLoop: async ({ model, onStep }) => {
        const id = (model as unknown as { modelId: string }).modelId;
        used.push(id);
        if (id.startsWith("google")) throw apiError(429);
        onStep({ ms: 1, toolCalls: 1 });
        return { steps: 1 };
      },
    });
    const trace = createTracer(repo, run.id, "scout");
    const result = await llm.runToolLoop(tools, "sys", loopOptions(vi.fn(async () => undefined), trace, run.id));
    expect(used).toEqual(["google-main", "groq-main"]);
    expect(result).toMatchObject({ source: "llm", provider: "groq" });
    expect(warnings(repo)).toEqual(["Gemini is busy. Trying Groq."]);
  });

  it("hands over to the deterministic plan, without switching model, when it fails part-way", async () => {
    const used: string[] = [];
    const fallback = vi.fn(async () => undefined);
    const { llm, repo, run } = setup([], {
      callLoop: async ({ model, onStep }) => {
        used.push((model as unknown as { modelId: string }).modelId);
        onStep({ ms: 1, toolCalls: 1 });
        throw apiError(429);
      },
    });
    const trace = createTracer(repo, run.id, "scout");
    const result = await llm.runToolLoop(tools, "sys", loopOptions(fallback, trace, run.id));
    expect(used).toEqual(["google-main"]);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("fallback");
    expect(warnings(repo)).toEqual(["Gemini is busy.", "The language model is busy, using the standard plan."]);
  });

  it("uses the deterministic plan when every provider fails", async () => {
    const fallback = vi.fn(async () => undefined);
    const { llm } = setup([], {
      callLoop: async () => {
        throw apiError(429);
      },
    });
    const result = await llm.runToolLoop(tools, "sys", loopOptions(fallback));
    expect(result.source).toBe("fallback");
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe("thinking limits", () => {
  it("gives Gemini a low thinking level for the main model and minimal for the fast one", () => {
    const { providers } = resolveProviders(
      parseEnv({
        DATABASE_URL: "postgres://x",
        LLM_MODE: "live",
        LLM_PROVIDER: "google",
        GOOGLE_GENERATIVE_AI_API_KEY: "k",
        LLM_MODEL: "m",
        LLM_MODEL_FAST: "f",
      }),
    );
    expect(providers[0].model("main")?.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: "low" } } });
    expect(providers[0].model("fast")?.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: "minimal" } } });
  });

  it("passes the provider options through to the model call", async () => {
    const seen: unknown[] = [];
    const withOptions: ProviderEntry = {
      name: "google",
      label: "Gemini",
      model: (tier) => ({
        id: "g",
        model: {} as unknown as LanguageModel,
        providerOptions: { google: { thinkingConfig: { thinkingLevel: tier === "main" ? "low" : "minimal" } } },
      }),
    };
    const { llm, options } = setup([], {
      providers: [withOptions],
      callStructured: async ({ providerOptions }) => {
        seen.push(providerOptions);
        return good;
      },
    });
    await llm.generateStructured(schema, "p", options());
    expect(seen).toEqual([{ google: { thinkingConfig: { thinkingLevel: "low" } } }]);
  });
});

describe("the provider chain", () => {
  const base = {
    DATABASE_URL: "postgres://x",
    LLM_MODE: "live",
    LLM_PROVIDER: "google",
    GOOGLE_GENERATIVE_AI_API_KEY: "g-key",
    LLM_MODEL: "gemini-main",
    LLM_MODEL_FAST: "gemini-fast",
  };
  const full = {
    ...base,
    LLM_FALLBACK_PROVIDERS: "groq,openai-compatible",
    GROQ_API_KEY: "q-key",
    GROQ_MODEL: "groq-main",
    GROQ_MODEL_FAST: "groq-main",
    OPENAI_COMPATIBLE_API_KEY: "o-key",
    OPENAI_COMPATIBLE_BASE_URL: "https://openrouter.ai/api/v1",
    OPENAI_COMPATIBLE_MODEL: "router-main",
    OPENAI_COMPATIBLE_MODEL_FAST: "router-fast",
  };

  it("builds the main provider with models from the environment", () => {
    const { providers, notes } = resolveProviders(parseEnv(base));
    expect(providers.map((p) => p.name)).toEqual(["google"]);
    expect(providers[0].label).toBe("Gemini");
    expect(providers[0].model("main")?.id).toBe("gemini-main");
    expect(providers[0].model("fast")?.id).toBe("gemini-fast");
    expect(notes).toEqual([]);
  });

  it("builds a chain of fallbacks in the order listed, each with its own model names", () => {
    const { providers, notes } = resolveProviders(parseEnv(full));
    expect(providers.map((p) => [p.name, p.label])).toEqual([
      ["google", "Gemini"],
      ["groq", "Groq"],
      ["openai-compatible", "OpenRouter"],
    ]);
    expect(providers[1].model("fast")?.id).toBe("groq-main");
    expect(providers[2].model("main")?.id).toBe("router-main");
    expect(notes).toEqual([]);
  });

  it("keeps the order the developer wrote", () => {
    const env = parseEnv({ ...full, LLM_FALLBACK_PROVIDERS: " openai-compatible , groq " });
    expect(resolveProviders(env).providers.map((p) => p.name)).toEqual(["google", "openai-compatible", "groq"]);
  });

  it("names a non-OpenRouter endpoint plainly", () => {
    const env = parseEnv({ ...full, OPENAI_COMPATIBLE_BASE_URL: "https://api.example.com/v1" });
    expect(resolveProviders(env).providers[2].label).toBe("the backup model");
  });

  it("skips a fallback, with a note, when its model names are missing", () => {
    const env = parseEnv({ ...base, LLM_FALLBACK_PROVIDERS: "groq", GROQ_API_KEY: "q" });
    const { providers, notes } = resolveProviders(env);
    expect(providers.map((p) => p.name)).toEqual(["google"]);
    expect(notes).toEqual(["Groq needs its model names set in the environment."]);
  });

  it("skips a fallback that has no key, and carries on with the rest of the chain", () => {
    const env = parseEnv({ ...full, GROQ_API_KEY: "" });
    const { providers, notes } = resolveProviders(env);
    expect(providers.map((p) => p.name)).toEqual(["google", "openai-compatible"]);
    expect(notes).toEqual(["Groq has no API key."]);
  });

  it("notes providers whose package is not installed", () => {
    const env = parseEnv({ ...base, LLM_FALLBACK_PROVIDERS: "anthropic" });
    const { providers, notes } = resolveProviders(env);
    expect(providers).toHaveLength(1);
    expect(notes).toEqual(["anthropic is not installed in this build."]);
  });

  it("ignores a fallback that repeats the main provider", () => {
    const { providers } = resolveProviders(parseEnv({ ...base, LLM_FALLBACK_PROVIDERS: "google,google" }));
    expect(providers).toHaveLength(1);
  });

  it("rejects an unknown provider name, so xAI is not accepted", () => {
    expect(() => parseEnv({ ...base, LLM_FALLBACK_PROVIDERS: "xai" })).toThrow(/LLM_FALLBACK_PROVIDERS/);
  });

  it("sets the thinking level for each tier from the environment", () => {
    const env = parseEnv({ ...base, LLM_THINKING_MAIN: "medium", LLM_THINKING_FAST: "low" });
    const gemini = resolveProviders(env).providers[0];
    expect(gemini.model("main")?.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: "medium" } } });
    expect(gemini.model("fast")?.providerOptions).toEqual({ google: { thinkingConfig: { thinkingLevel: "low" } } });
  });
});

describe("timings and rejected keys", () => {
  it("puts how long each answer took into the trace", async () => {
    let clock = 1_000;
    const { llm, repo, options } = setup([() => good], { now: () => clock });
    // The stub answers instantly, so move the clock inside the call to simulate 2.4 s.
    const callStructured = async () => {
      clock += 2400;
      return good;
    };
    const timed = createLlm({
      mode: "live",
      providers: [provider("google", "Gemini")],
      store: createMemoryLlmStore(),
      now: () => clock,
      callStructured,
    });
    void llm;
    const result = await timed.generateStructured(schema, "p", options());
    expect(result.ms).toBe(2400);
    const line = repo.traces.find((t) => t.message.startsWith("Gemini answered"));
    expect(line?.message).toBe("Gemini answered in 2.4 s.");
    expect(line?.data).toMatchObject({ provider: "google", model: "google-main", ms: 2400, key: "design" });
  });

  it("puts each tool-loop step into the trace with its tool calls and time", async () => {
    const { llm, repo, run } = setup([], {
      callLoop: async ({ onStep }) => {
        onStep({ ms: 2800, toolCalls: 4 });
        onStep({ ms: 1500, toolCalls: 1 });
        onStep({ ms: 900, toolCalls: 0 });
        return { steps: 3 };
      },
    });
    const trace = createTracer(repo, run.id, "scout");
    await llm.runToolLoop({} as ToolSet, "sys", { runId: run.id, tier: "fast", prompt: "p", maxSteps: 3, fallback: async () => undefined, trace });
    await Promise.resolve();
    expect(repo.traces.map((t) => t.message)).toEqual([
      "Gemini step 1: 4 tool calls in 2.8 s.",
      "Gemini step 2: 1 tool call in 1.5 s.",
      "Gemini step 3: no tool calls in 0.9 s.",
    ]);
  });

  it("does not ask a provider again after it rejected the key", async () => {
    const { llm, calls, repo, options } = setup(
      [
        () => {
          throw apiError(401);
        },
        () => good,
        () => good,
      ],
      { providers: [provider("google", "Gemini"), provider("groq", "Groq")] },
    );
    const first = await llm.generateStructured(schema, "p", options({ cacheKey: "one" }));
    const second = await llm.generateStructured(schema, "p", options({ cacheKey: "two" }));
    expect(first.provider).toBe("groq");
    expect(second.provider).toBe("groq");
    expect(calls.map((c) => c.model)).toEqual(["google-main", "groq-main", "groq-main"]);
    expect(warnings(repo)).toEqual(["Gemini did not accept our key. Trying Groq."]);
  });

  it("skips a rejected provider in the tool loop too", async () => {
    const used: string[] = [];
    const { llm } = setup([], {
      callLoop: async ({ model, onStep }) => {
        const id = (model as unknown as { modelId: string }).modelId;
        used.push(id);
        if (id.startsWith("google")) throw apiError(403);
        onStep({ ms: 1, toolCalls: 1 });
        return { steps: 1 };
      },
    });
    const loop = (fallback: () => Promise<void>) => ({ runId: "r", tier: "fast" as const, prompt: "p", maxSteps: 3, fallback });
    await llm.runToolLoop({} as ToolSet, "sys", loop(async () => undefined));
    await llm.runToolLoop({} as ToolSet, "sys", loop(async () => undefined));
    expect(used).toEqual(["google-main", "groq-main", "groq-main"]);
  });
});

describe("the quicker model", () => {
  const busy = () => {
    throw apiError(503);
  };

  it("tries the provider's own fast model before the next provider when the main model is busy", async () => {
    const { llm, calls, repo, options } = setup([busy, busy, busy, () => good], { providers: [provider("google", "Gemini", true), provider("groq", "Groq")] });
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toMatchObject({ source: "llm", provider: "google", model: "google-fast" });
    expect(calls.map((c) => c.model)).toEqual(["google-main", "google-main", "google-main", "google-fast"]);
    expect(warnings(repo)).toEqual(["Gemini is busy. Trying Gemini (quicker model)."]);
  });

  it("is not tried for a fast-tier question, which already uses the fast model", async () => {
    const { llm, calls, options } = setup([() => good], { providers: [provider("google", "Gemini", true)] });
    await llm.generateStructured(schema, "p", options({ tier: "fast" }));
    expect(calls.map((c) => c.model)).toEqual(["google-fast"]);
  });

  it("does not ask a provider that rejected our key again under its other model", async () => {
    const rejected = () => {
      throw apiError(401);
    };
    const { llm, calls, options } = setup([rejected, () => good], { providers: [provider("google", "Gemini", true), provider("groq", "Groq")] });
    const result = await llm.generateStructured(schema, "p", options());
    expect(result).toMatchObject({ provider: "groq" });
    expect(calls.map((c) => c.model)).toEqual(["google-main", "groq-main"]);
  });
});
