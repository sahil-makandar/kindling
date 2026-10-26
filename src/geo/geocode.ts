import { createHash } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/src/config/env";
import { getDb } from "@/src/db/client";
import { createPacer } from "@/src/lib/pacer";
import { createDbGeocodeStore, type GeocodeStore } from "./store";

// Address to coordinates with OpenStreetMap's Nominatim. Usage policy: at most one request per second,
// an identifying User-Agent, and cache results (https://operations.osmfoundation.org/policies/nominatim/).

export type GeocodeCandidate = { lat: number; lon: number; displayName: string };

// The best match plus the other places Nominatim thought of. A bare "New York" is ambiguous (city or
// state), and the first match is sometimes the wrong one, so callers show displayName and offer the
// alternatives.
export type GeocodeResult = GeocodeCandidate & { alternatives: GeocodeCandidate[] };

export class GeocodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodeError";
  }
}

export type GeocoderDeps = {
  userAgent: string;
  store: GeocodeStore;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  timeoutMs?: number;
  // Found addresses stay cached for a week. Misses expire sooner so a typo fixed upstream is retried.
  hitTtlMs?: number;
  missTtlMs?: number;
};

const MAX_ADDRESS_LENGTH = 200;
const CANDIDATES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const nominatimResponse = z.array(
  z.looseObject({
    lat: z.string(),
    lon: z.string(),
    display_name: z.string().optional(),
  }),
);

const candidateSchema = z.object({ lat: z.number(), lon: z.number(), displayName: z.string() });

// What we store: either a hit or a known miss.
const cachedEntry = z.union([
  candidateSchema.extend({ found: z.literal(true), alternatives: z.array(candidateSchema).default([]) }),
  z.object({ found: z.literal(false) }),
]);

function cacheKey(address: string): string {
  const normal = address.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(`nominatim:search:${normal}`).digest("hex");
}

export function createGeocoder(deps: GeocoderDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const baseUrl = deps.baseUrl ?? "https://nominatim.openstreetmap.org";
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const hitTtlMs = deps.hitTtlMs ?? 7 * DAY_MS;
  const missTtlMs = deps.missTtlMs ?? DAY_MS;
  const pace = createPacer(deps.minIntervalMs ?? 1000, now, deps.sleep);

  async function search(address: string): Promise<GeocodeResult | null> {
    await pace();
    const url = `${baseUrl}/search?${new URLSearchParams({ q: address, format: "jsonv2", limit: String(CANDIDATES) })}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, {
        headers: { "User-Agent": deps.userAgent, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "AbortError";
      throw new GeocodeError(
        timedOut ? "The address lookup took too long. Try again." : "Could not reach the address lookup service.",
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) throw new GeocodeError("The address lookup is busy. Try again in a minute.");
    if (!res.ok) throw new GeocodeError(`The address lookup failed (status ${res.status}).`);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GeocodeError("The address lookup sent a reply we could not read.");
    }
    const parsed = nominatimResponse.safeParse(body);
    if (!parsed.success) throw new GeocodeError("The address lookup sent a reply we could not read.");

    const candidates: GeocodeCandidate[] = [];
    for (const row of parsed.data) {
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        candidates.push({ lat, lon, displayName: row.display_name ?? address });
      }
    }
    if (candidates.length === 0) {
      if (parsed.data.length > 0) throw new GeocodeError("The address lookup sent a reply we could not read.");
      return null;
    }
    const [best, ...alternatives] = candidates;
    return { ...best, alternatives };
  }

  // Returns null when the address cannot be found. Throws GeocodeError when the service fails.
  async function geocode(address: string): Promise<GeocodeResult | null> {
    const trimmed = address.trim();
    if (trimmed.length === 0) throw new GeocodeError("Enter an address first.");
    if (trimmed.length > MAX_ADDRESS_LENGTH) throw new GeocodeError("That address is too long.");

    const key = cacheKey(trimmed);
    try {
      const cached = cachedEntry.safeParse(await deps.store.get(key));
      if (cached.success) {
        if (!cached.data.found) return null;
        const { lat, lon, displayName, alternatives } = cached.data;
        return { lat, lon, displayName, alternatives };
      }
    } catch {
      // A cache outage only costs us a lookup.
    }

    const result = await search(trimmed);
    try {
      await deps.store.set(
        key,
        result ? { found: true, ...result } : { found: false },
        new Date(now() + (result ? hitTtlMs : missTtlMs)),
      );
    } catch {
      // Not caching is fine.
    }
    return result;
  }

  return { geocode };
}

// One shared geocoder per process, so the one-per-second pace holds across requests.
const globalForGeo = globalThis as unknown as { __geocoder?: ReturnType<typeof createGeocoder> };

export function geocode(address: string): Promise<GeocodeResult | null> {
  if (!globalForGeo.__geocoder) {
    globalForGeo.__geocoder = createGeocoder({
      userAgent: getEnv().NOMINATIM_USER_AGENT,
      store: createDbGeocodeStore(getDb()),
    });
  }
  return globalForGeo.__geocoder.geocode(address);
}
