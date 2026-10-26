import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  Output,
  RetryError,
  stepCountIs,
  type LanguageModel,
  type ToolSet,
} from "ai";
import type { z } from "zod";
import { getEnv } from "@/src/config/env";
import { getDb } from "@/src/db/client";
import { createDbLlmStore, type LlmStore } from "./llmStore";
import { resolveProviders, type CallProviderOptions, type LlmTier, type ProviderEntry } from "./llmProviders";
import type { Tracer } from "./trace";

// The only place that talks to a language model. Rules (CLAUDE.md section 5): few small calls, never on page
// views, every answer cached per run, back off when rate limited, then try the fallback provider, then give
// the caller a chance to use its deterministic plan so a busy model never breaks a run.

export type LlmSource = "cache" | "llm" | "mock" | "fallback";

export type StructuredResult<T> = { output: T; source: LlmSource; provider?: string; model?: string };

export type StructuredOptions<T> = {
  runId: string;
  // Names the question, for example "design". The answer is cached under it for this run.
  cacheKey: string;
  // "fast" for Scout and Baseline, "main" for Designer, Producer and Coach.
  tier: LlmTier;
  system?: string;
  // Deterministic answer used when no model can answer.
  fallback: () => T | Promise<T>;
  // Canned answer used when LLM_MODE=mock (tests and keyless development).
  mock: () => T;
  // Extra rule the schema cannot express, for example "every id is in the pool". Throw to reject the answer;
  // the model then gets one retry with the reason attached.
  check?: (value: T) => void;
  trace?: Tracer;
  maxOutputTokens?: number;
};

export type LoopOptions = {
  runId: string;
  tier: LlmTier;
  prompt: string;
  maxSteps: number;
  // The deterministic plan. Runs when LLM_MODE=mock, and finishes the job when a model fails part-way.
  fallback: () => Promise<void>;
  trace?: Tracer;
  // How long the model may spend before the deterministic plan takes over. Default 30 s.
  budgetMs?: number;
  // How long one model step may take, so a single stalled request cannot use up the whole budget. Default 15 s.
  stepMs?: number;
};

export type LoopResult = { source: Exclude<LlmSource, "cache">; steps: number; provider?: string; model?: string };

type StructuredCall = (args: {
  model: LanguageModel;
  system?: string;
  prompt: string;
  schema: z.ZodType;
  signal: AbortSignal;
  maxOutputTokens?: number;
  providerOptions?: CallProviderOptions;
}) => Promise<unknown>;

type LoopCall = (args: {
  model: LanguageModel;
  system: string;
  prompt: string;
  tools: ToolSet;
  maxSteps: number;
  signal: AbortSignal;
  stepMs: number;
  onStep: () => void;
  providerOptions?: CallProviderOptions;
}) => Promise<{ steps: number }>;

export type LlmDeps = {
  mode: "mock" | "live";
  providers: ProviderEntry[];
  store: LlmStore;
  callStructured?: StructuredCall;
  callLoop?: LoopCall;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  // Whole-call time limit for generateStructured, across retries and providers. Agent routes must finish in 60 s.
  budgetMs?: number;
  // Waits before each retry after a rate limit: 2 s, then 6 s.
  backoffMs?: number[];
};

const BUSY_MESSAGE = "The language model is busy, using the standard plan.";

// An answer that did not match the schema or the caller's check.
class AnswerRejected extends Error {}
// A provider that could not give an answer. The message is fit for the trace; detail is for debugging only.
class ProviderFailed extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

function statusOf(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (RetryError.isInstance(error)) return statusOf(error.lastError);
  return undefined;
}

// 429 is the free-tier limit; 503 is "high demand", which Gemini sends often.
const isBusy = (error: unknown) => statusOf(error) === 429 || statusOf(error) === 503;
const isRejectedKey = (error: unknown) => statusOf(error) === 401 || statusOf(error) === 403;
const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

function rejectionReason(error: unknown): string {
  const cause = (error as { cause?: unknown }).cause;
  const text = cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 400);
}

const defaultStructured: StructuredCall = async ({
  model,
  system,
  prompt,
  schema,
  signal,
  maxOutputTokens,
  providerOptions,
}) => {
  const { output } = await generateText({
    model,
    system,
    prompt,
    output: Output.object({ schema }),
    maxRetries: 0, // we do our own backoff so the time budget stays in our hands
    abortSignal: signal,
    maxOutputTokens,
    providerOptions,
  });
  return output;
};

const defaultLoop: LoopCall = async ({
  model,
  system,
  prompt,
  tools,
  maxSteps,
  signal,
  stepMs,
  onStep,
  providerOptions,
}) => {
  const result = await generateText({
    model,
    system,
    prompt,
    tools,
    stopWhen: stepCountIs(maxSteps),
    maxRetries: 2,
    abortSignal: signal,
    timeout: { stepMs },
    providerOptions,
    onStepFinish: () => onStep(),
  });
  return { steps: result.steps.length };
};

export function createLlm(deps: LlmDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const budgetMs = deps.budgetMs ?? 40_000;
  const backoffMs = deps.backoffMs ?? [2000, 6000];
  const callStructured = deps.callStructured ?? defaultStructured;
  const callLoop = deps.callLoop ?? defaultLoop;

  // Asks one provider, with backoff on rate limits and one retry when the answer is rejected.
  async function askProvider<T>(
    entry: ProviderEntry,
    schema: z.ZodType<T>,
    prompt: string,
    opts: StructuredOptions<T>,
    deadline: number,
  ): Promise<{ output: T; model: string }> {
    const handle = entry.model(opts.tier);
    if (!handle) throw new ProviderFailed(`no model is set for ${entry.label}`);

    let currentPrompt = prompt;
    let rejected = false;
    let busyRetries = 0;

    for (;;) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new ProviderFailed("ran out of time");

      await deps.store.countCall(opts.runId).catch(() => undefined);
      try {
        const raw = await callStructured({
          model: handle.model,
          system: opts.system,
          prompt: currentPrompt,
          schema,
          signal: AbortSignal.timeout(remaining),
          maxOutputTokens: opts.maxOutputTokens,
          providerOptions: handle.providerOptions,
        });
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new AnswerRejected(parsed.error.message);
        try {
          opts.check?.(parsed.data);
        } catch (e) {
          throw new AnswerRejected(e instanceof Error ? e.message : String(e));
        }
        return { output: parsed.data, model: handle.id };
      } catch (error) {
        if (isTimeout(error)) throw new ProviderFailed("took too long");
        if (isRejectedKey(error)) throw new ProviderFailed("did not accept our key");

        if (isBusy(error)) {
          const delay = backoffMs[busyRetries];
          if (delay === undefined || deadline - now() <= delay) throw new ProviderFailed("is busy");
          busyRetries += 1;
          await sleep(delay);
          continue;
        }

        const badAnswer = error instanceof AnswerRejected || NoObjectGeneratedError.isInstance(error);
        if (badAnswer && !rejected) {
          rejected = true;
          currentPrompt = `${prompt}\n\nYour previous answer was rejected: ${rejectionReason(error)}\nAnswer again, fixing that, and follow the format exactly.`;
          continue;
        }
        throw new ProviderFailed(badAnswer ? "gave an answer we could not use" : "failed", rejectionReason(error));
      }
    }
  }

  async function generateStructured<T>(
    schema: z.ZodType<T>,
    prompt: string,
    opts: StructuredOptions<T>,
  ): Promise<StructuredResult<T>> {
    // 1. Never ask twice for the same run.
    const cached = await deps.store.get(opts.runId, opts.cacheKey).catch(() => undefined);
    if (cached) {
      const parsed = schema.safeParse(cached.output);
      if (parsed.success) return { output: parsed.data, source: "cache", provider: cached.provider, model: cached.model };
    }

    // 2. Keyless development and tests.
    if (deps.mode === "mock") {
      const output = schema.parse(opts.mock());
      return { output, source: "mock" };
    }

    // 3. Main provider, then the fallback provider, all inside one time budget.
    const deadline = now() + budgetMs;
    for (const [index, entry] of deps.providers.entries()) {
      try {
        const { output, model } = await askProvider(entry, schema, prompt, opts, deadline);
        await deps.store.set(opts.runId, opts.cacheKey, { output, provider: entry.name, model }).catch(() => undefined);
        return { output, source: "llm", provider: entry.name, model };
      } catch (error) {
        if (!(error instanceof ProviderFailed)) throw error;
        const next = deps.providers[index + 1];
        await opts.trace?.warn(
          `${entry.label} ${error.message}.${next ? ` Trying ${next.label}.` : ""}`,
          { provider: entry.name, detail: error.detail },
        );
      }
    }

    // 4. Nobody answered: the caller's deterministic answer. Not cached, so a later run can still use a model.
    await opts.trace?.warn(BUSY_MESSAGE);
    return { output: await opts.fallback(), source: "fallback" };
  }

  // A tool-calling loop: the model picks the next tool call from what it has found so far. If no model can
  // run it, or it fails part-way, the caller's deterministic plan takes over.
  async function runToolLoop(tools: ToolSet, system: string, opts: LoopOptions): Promise<LoopResult> {
    if (deps.mode === "mock") {
      await opts.fallback();
      return { source: "mock", steps: 0 };
    }

    const deadline = now() + (opts.budgetMs ?? 30_000);
    for (const [index, entry] of deps.providers.entries()) {
      const handle = entry.model(opts.tier);
      if (!handle) continue;
      let steps = 0;
      try {
        await callLoop({
          model: handle.model,
          system,
          prompt: opts.prompt,
          tools,
          maxSteps: opts.maxSteps,
          signal: AbortSignal.timeout(Math.max(1, deadline - now())),
          stepMs: opts.stepMs ?? 15_000,
          providerOptions: handle.providerOptions,
          onStep: () => {
            steps += 1;
            void deps.store.countCall(opts.runId).catch(() => undefined);
          },
        });
        return { source: "llm", steps, provider: entry.name, model: handle.id };
      } catch (error) {
        const reason = isTimeout(error)
          ? "took too long"
          : isRejectedKey(error)
            ? "did not accept our key"
            : isBusy(error)
              ? "is busy"
              : "failed";
        // A request that failed before its first step still used quota.
        if (steps === 0) await deps.store.countCall(opts.runId).catch(() => undefined);

        // Tools already ran, so another model would repeat work. Let the deterministic plan finish instead.
        const next = steps === 0 ? deps.providers[index + 1] : undefined;
        await opts.trace?.warn(`${entry.label} ${reason}.${next ? ` Trying ${next.label}.` : ""}`, {
          provider: entry.name,
          steps,
        });
        if (steps > 0 || isTimeout(error)) break;
      }
    }

    await opts.trace?.warn(BUSY_MESSAGE);
    await opts.fallback();
    return { source: "fallback", steps: 0 };
  }

  return { generateStructured, runToolLoop };
}

export type Llm = ReturnType<typeof createLlm>;

// One shared instance per process, built on first use so importing this file needs no keys or database.
const globalForLlm = globalThis as unknown as { __llm?: Llm };

function getLlm(): Llm {
  if (!globalForLlm.__llm) {
    const env = getEnv();
    globalForLlm.__llm = createLlm({
      mode: env.LLM_MODE,
      providers: resolveProviders(env).providers,
      store: createDbLlmStore(getDb()),
    });
  }
  return globalForLlm.__llm;
}

export const generateStructured: Llm["generateStructured"] = (schema, prompt, opts) =>
  getLlm().generateStructured(schema, prompt, opts);

export const runToolLoop: Llm["runToolLoop"] = (tools, system, opts) => getLlm().runToolLoop(tools, system, opts);
