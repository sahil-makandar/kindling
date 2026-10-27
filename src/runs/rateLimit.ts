import { sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { rateLimits } from "@/src/db/schema";
import { HttpError } from "./http";

// A fixed-window limit per key (for example per IP address), kept in the database so it holds across serverless
// instances (CLAUDE.md section 9).

export type RateStore = {
  // Adds one to the key's count for this window and returns the new count.
  hit(key: string, windowStart: Date): Promise<number>;
};

export function createDbRateStore(db: Db): RateStore {
  return {
    async hit(key, windowStart) {
      const [row] = await db
        .insert(rateLimits)
        .values({ key, windowStart, count: 1 })
        .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
        .returning({ count: rateLimits.count });
      return row?.count ?? 1;
    },
  };
}

export type RateResult = { allowed: boolean; count: number; limit: number; retryAfterSeconds: number };

export async function checkRateLimit(
  store: RateStore,
  key: string,
  limit: number,
  now: number = Date.now(),
  windowMs: number = 60 * 60 * 1000,
): Promise<RateResult> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const count = await store.hit(key, new Date(windowStart));
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

export function createMemoryRateStore(): RateStore {
  const counts = new Map<string, number>();
  return {
    async hit(key, windowStart) {
      const id = `${key}@${windowStart.getTime()}`;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
      return next;
    },
  };
}

// Throws a friendly 429 when this caller has used up their allowance for a kind of request this hour. Used on the routes
// that can spend model or Qloo calls, so a script cannot run up the free tiers.
export async function enforceLimit(store: RateStore, key: string, limit: number, what: string): Promise<void> {
  const result = await checkRateLimit(store, key, limit);
  if (result.allowed) return;
  const minutes = Math.ceil(result.retryAfterSeconds / 60);
  throw new HttpError(429, `That is more ${what} than the free demo allows in an hour. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
    retryAfterSeconds: result.retryAfterSeconds,
  });
}
