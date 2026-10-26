import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { geocodeCache } from "@/src/db/schema";

// Where the geocoder keeps its cache. The real one is Postgres; tests use the in-memory one.
export interface GeocodeStore {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, response: unknown, expiresAt: Date): Promise<void>;
}

export function createDbGeocodeStore(db: Db): GeocodeStore {
  return {
    async get(key) {
      const [row] = await db
        .select({ response: geocodeCache.response })
        .from(geocodeCache)
        .where(and(eq(geocodeCache.key, key), gt(geocodeCache.expiresAt, new Date())));
      return row?.response;
    },

    async set(key, response, expiresAt) {
      await db
        .insert(geocodeCache)
        .values({ key, response, expiresAt })
        .onConflictDoUpdate({ target: geocodeCache.key, set: { response, expiresAt } });
    },
  };
}

export function createMemoryGeocodeStore(now: () => number = Date.now): GeocodeStore & {
  cache: Map<string, { response: unknown; expiresAt: Date }>;
} {
  const cache = new Map<string, { response: unknown; expiresAt: Date }>();
  return {
    cache,
    async get(key) {
      const hit = cache.get(key);
      return hit && hit.expiresAt.getTime() > now() ? hit.response : undefined;
    },
    async set(key, response, expiresAt) {
      cache.set(key, { response, expiresAt });
    },
  };
}
