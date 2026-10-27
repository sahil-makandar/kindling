import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { qlooCache, qlooCalls } from "@/src/db/schema";
import { createBatcher, type Batcher } from "@/src/lib/batcher";

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

type CallInsert = typeof qlooCalls.$inferInsert;

// Call log rows are saved in batches (one connection shares one batcher). The id is made here, so the caller has it
// at once, and a stage saves the log before the rows that point at it.
const callBatchers = new WeakMap<Db, Batcher<CallInsert>>();
function callBatcher(db: Db): Batcher<CallInsert> {
  let batcher = callBatchers.get(db);
  if (!batcher) {
    batcher = createBatcher(async (rows) => {
      await db.insert(qlooCalls).values(rows);
    });
    callBatchers.set(db, batcher);
  }
  return batcher;
}

type CacheInsert = typeof qlooCache.$inferInsert;

// Cache writes are best effort and nobody waits for them, so they go out in batches too.
const cacheBatchers = new WeakMap<Db, Batcher<CacheInsert>>();
function cacheBatcher(db: Db): Batcher<CacheInsert> {
  let batcher = cacheBatchers.get(db);
  if (!batcher) {
    batcher = createBatcher(async (rows) => {
      // One statement cannot update the same key twice, so keep the last row for each key.
      const latest = [...new Map(rows.map((row) => [row.key, row])).values()];
      await db
        .insert(qlooCache)
        .values(latest)
        .onConflictDoUpdate({
          target: qlooCache.key,
          set: { response: sql`excluded.response`, expiresAt: sql`excluded.expires_at` },
        });
    });
    cacheBatchers.set(db, batcher);
  }
  return batcher;
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
      cacheBatcher(db).add({ key, response, expiresAt });
    },

    async logCall(entry) {
      const id = randomUUID();
      callBatcher(db).add({
        id,
        runId: entry.runId,
        purpose: entry.purpose,
        endpoint: entry.endpoint,
        params: entry.params,
        status: entry.status,
        ms: entry.ms,
        resultCount: entry.resultCount,
        cached: entry.cached,
      });
      return id;
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
