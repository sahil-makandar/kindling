import { sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { rateLimits } from "@/src/db/schema";

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
