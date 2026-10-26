import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { qlooCache, qlooCalls, runs } from "@/src/db/schema";

export type CallLogEntry = {
  runId?: string;
  purpose: string;
  endpoint: string;
  params: Record<string, string>;
  status: number;
  ms: number;
  resultCount: number | null;
  cached: boolean;
};

// Where the client keeps its 24 hour cache and its call log. The real one is Postgres;
// tests use the in-memory one.
export interface QlooStore {
  getCache(key: string): Promise<unknown | undefined>;
  setCache(key: string, response: unknown, expiresAt: Date): Promise<void>;
  // Returns the log row id so results can point at the call that produced them.
  logCall(entry: CallLogEntry): Promise<string | null>;
}

export function createDbStore(db: Db): QlooStore {
  return {
    async getCache(key) {
      const [row] = await db
        .select({ response: qlooCache.response })
        .from(qlooCache)
        .where(and(eq(qlooCache.key, key), gt(qlooCache.expiresAt, new Date())));
      return row?.response;
    },

    async setCache(key, response, expiresAt) {
      await db
        .insert(qlooCache)
        .values({ key, response, expiresAt })
        .onConflictDoUpdate({ target: qlooCache.key, set: { response, expiresAt } });
    },

    async logCall(entry) {
      const [row] = await db
        .insert(qlooCalls)
        .values({
          runId: entry.runId,
          purpose: entry.purpose,
          endpoint: entry.endpoint,
          params: entry.params,
          status: entry.status,
          ms: entry.ms,
          resultCount: entry.resultCount,
          cached: entry.cached,
        })
        .returning({ id: qlooCalls.id });
      if (entry.runId) {
        await db
          .update(runs)
          .set({ qlooCallCount: sql`${runs.qlooCallCount} + 1` })
          .where(eq(runs.id, entry.runId));
      }
      return row?.id ?? null;
    },
  };
}

export type MemoryStore = QlooStore & {
  calls: CallLogEntry[];
  cache: Map<string, { response: unknown; expiresAt: Date }>;
};

export function createMemoryStore(now: () => number = Date.now): MemoryStore {
  const calls: CallLogEntry[] = [];
  const cache = new Map<string, { response: unknown; expiresAt: Date }>();
  return {
    calls,
    cache,
    async getCache(key) {
      const hit = cache.get(key);
      return hit && hit.expiresAt.getTime() > now() ? hit.response : undefined;
    },
    async setCache(key, response, expiresAt) {
      cache.set(key, { response, expiresAt });
    },
    async logCall(entry) {
      calls.push(entry);
      return `call-${calls.length}`;
    },
  };
}
