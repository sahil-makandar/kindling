import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { llmOutputs, runs } from "@/src/db/schema";

export type CachedOutput = { output: unknown; provider: string; model: string };

// Where the LLM layer keeps each run's cached answers and its call count.
// The real one is Postgres; tests use the in-memory one.
export interface LlmStore {
  get(runId: string, cacheKey: string): Promise<CachedOutput | undefined>;
  set(runId: string, cacheKey: string, value: CachedOutput): Promise<void>;
  // One more request sent to a language model for this run (the free tiers are small, so we count them).
  countCall(runId: string): Promise<void>;
}

export function createDbLlmStore(db: Db): LlmStore {
  return {
    async get(runId, cacheKey) {
      const [row] = await db
        .select({ output: llmOutputs.output, provider: llmOutputs.provider, model: llmOutputs.model })
        .from(llmOutputs)
        .where(and(eq(llmOutputs.runId, runId), eq(llmOutputs.cacheKey, cacheKey)));
      return row;
    },

    async set(runId, cacheKey, value) {
      await db
        .insert(llmOutputs)
        .values({ runId, cacheKey, ...value })
        .onConflictDoUpdate({
          target: [llmOutputs.runId, llmOutputs.cacheKey],
          set: { output: value.output, provider: value.provider, model: value.model },
        });
    },

    async countCall(runId) {
      await db
        .update(runs)
        .set({ llmCallCount: sql`${runs.llmCallCount} + 1` })
        .where(eq(runs.id, runId));
    },
  };
}

export type MemoryLlmStore = LlmStore & {
  cache: Map<string, CachedOutput>;
  calls: Map<string, number>;
};

export function createMemoryLlmStore(): MemoryLlmStore {
  const cache = new Map<string, CachedOutput>();
  const calls = new Map<string, number>();
  return {
    cache,
    calls,
    async get(runId, cacheKey) {
      return cache.get(`${runId}:${cacheKey}`);
    },
    async set(runId, cacheKey, value) {
      cache.set(`${runId}:${cacheKey}`, value);
    },
    async countCall(runId) {
      calls.set(runId, (calls.get(runId) ?? 0) + 1);
    },
  };
}
