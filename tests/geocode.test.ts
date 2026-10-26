import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGeocoder, GeocodeError, type GeocoderDeps } from "@/src/geo/geocode";
import { createMemoryGeocodeStore } from "@/src/geo/store";
import { createPacer } from "@/src/lib/pacer";

const UA = "kindling-test/0.1 (+https://example.test/repo)";

// What Nominatim really sends for "100 Crosby St, New York" (shortened). The first match is Hornell in
// upstate New York, not Manhattan, which is why results carry alternatives.
const crosby = [
  { place_id: 1, lat: "42.3175829", lon: "-77.6689742", display_name: "100, Crosby Street, City of Hornell, Steuben County, New York, 14843, United States" },
  { place_id: 2, lat: "40.7240280", lon: "-73.9969570", display_name: "100, Crosby Street, Little Italy, Lower Manhattan, Manhattan, New York County, New York, 10012, United States" },
  { place_id: 3, lat: "43.0394330", lon: "-77.0934270", display_name: "100, Crosby Street, Village of Newark, Wayne County, New York, 14513, United States" },
];
const manhattanOnly = [crosby[1]];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(overrides: Partial<GeocoderDeps> = {}, responses: Array<() => Response> = []) {
  const store = createMemoryGeocodeStore();
  const calls: Array<{ url: URL; at: number; headers: HeadersInit | undefined }> = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), at: Date.now(), headers: init?.headers });
    return (responses.shift() ?? (() => json(crosby)))();
  });
  const geocoder = createGeocoder({
    userAgent: UA,
    store,
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
  return { geocoder, store, fetchMock, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("geocode", () => {
  it("resolves 100 Crosby St, Manhattan near the real coordinates", async () => {
    const { geocoder } = setup({}, [() => json(manhattanOnly)]);
    const result = await geocoder.geocode("100 Crosby Street, Manhattan, New York");
    expect(result?.lon).toBeCloseTo(-73.997, 2);
    expect(result?.lat).toBeCloseTo(40.725, 2);
    expect(result?.displayName).toContain("Crosby Street");
    expect(result?.alternatives).toEqual([]);
  });

  it("returns the first match plus the other places it considered", async () => {
    const { geocoder } = setup();
    const result = await geocoder.geocode("100 Crosby St, New York");
    expect(result?.displayName).toContain("Hornell");
    expect(result?.alternatives.map((a) => a.displayName)).toEqual([
      expect.stringContaining("Manhattan"),
      expect.stringContaining("Newark"),
    ]);
    expect(result?.alternatives[0].lat).toBeCloseTo(40.724, 2);
  });

  it("asks for five jsonv2 candidates and sends the identifying User-Agent", async () => {
    const { geocoder, calls } = setup();
    await geocoder.geocode("100 Crosby St, New York");
    expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(calls[0].url.searchParams.get("q")).toBe("100 Crosby St, New York");
    expect(calls[0].url.searchParams.get("format")).toBe("jsonv2");
    expect(calls[0].url.searchParams.get("limit")).toBe("5");
    expect(JSON.stringify(calls[0].headers)).toContain(UA);
  });

  it("returns null when the address is not found", async () => {
    const { geocoder } = setup({}, [() => json([])]);
    expect(await geocoder.geocode("Nowhere Lane 99999")).toBeNull();
  });

  it("rejects an empty or very long address without calling the service", async () => {
    const { geocoder, fetchMock } = setup();
    await expect(geocoder.geocode("   ")).rejects.toBeInstanceOf(GeocodeError);
    await expect(geocoder.geocode("x".repeat(201))).rejects.toThrow(/too long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cache", () => {
  it("answers a repeat from the cache, ignoring case and spacing", async () => {
    const { geocoder, fetchMock } = setup();
    const first = geocoder.geocode("100 Crosby St, New York");
    await vi.advanceTimersByTimeAsync(10);
    await first;
    const again = await geocoder.geocode("  100  CROSBY st, new york ");
    expect(again?.lat).toBeCloseTo(42.3175829, 4);
    expect(again?.alternatives).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches a miss too, so a bad address is not looked up again", async () => {
    const { geocoder, fetchMock } = setup({}, [() => json([])]);
    await geocoder.geocode("Nowhere Lane");
    expect(await geocoder.geocode("Nowhere Lane")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a found address for 7 days and then looks it up again", async () => {
    const { geocoder, fetchMock } = setup();
    await geocoder.geocode("100 Crosby St");
    await vi.advanceTimersByTimeAsync(6 * 24 * 60 * 60 * 1000);
    await geocoder.geocode("100 Crosby St");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    const again = geocoder.geocode("100 Crosby St");
    await vi.advanceTimersByTimeAsync(10);
    await again;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a damaged cache entry and looks the address up", async () => {
    const { geocoder, store, fetchMock } = setup();
    const { createHash } = await import("node:crypto");
    const key = createHash("sha256").update("nominatim:search:100 crosby st").digest("hex");
    await store.set(key, { garbage: true }, new Date(Date.now() + 1e9));
    const result = await geocoder.geocode("100 Crosby St");
    expect(result?.lat).toBeCloseTo(42.3175829, 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("rate limit", () => {
  it("never starts two lookups less than a second apart", async () => {
    const { geocoder, calls } = setup();
    const all = Promise.all([geocoder.geocode("a st"), geocoder.geocode("b st"), geocoder.geocode("c st")]);
    await vi.advanceTimersByTimeAsync(5000);
    await all;
    expect(calls).toHaveLength(3);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(1000);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(1000);
  });
});

describe("failures", () => {
  it("turns a 429 into a plain message and does not cache it", async () => {
    const { geocoder, store } = setup({}, [() => json({}, 429)]);
    const failing = geocoder.geocode("100 Crosby St").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(((await failing) as Error).message).toMatch(/busy/);
    expect(store.cache.size).toBe(0);
  });

  it("turns a server error into a plain message", async () => {
    const { geocoder } = setup({}, [() => json({}, 503)]);
    const failing = geocoder.geocode("100 Crosby St").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(((await failing) as Error).message).toMatch(/status 503/);
  });

  it("reports a reply it cannot read", async () => {
    const { geocoder } = setup({}, [() => new Response("<html>oops</html>", { status: 200 })]);
    const failing = geocoder.geocode("100 Crosby St").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(((await failing) as Error).message).toMatch(/could not read/);
  });

  it("reports a network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { geocoder } = setup({ fetch: fetchMock as unknown as typeof fetch });
    const failing = geocoder.geocode("100 Crosby St").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(((await failing) as Error).message).toMatch(/Could not reach/);
  });

  it("times out", async () => {
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const { geocoder } = setup({ fetch: hang as unknown as typeof fetch });
    const failing = geocoder.geocode("100 Crosby St").catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_100);
    expect(((await failing) as Error).message).toMatch(/too long/);
  });

  it("keeps working when the cache store fails", async () => {
    const { geocoder, store } = setup();
    store.get = async () => {
      throw new Error("db down");
    };
    store.set = async () => {
      throw new Error("db down");
    };
    expect((await geocoder.geocode("100 Crosby St"))?.lon).toBeCloseTo(-77.6689742, 4);
  });
});

describe("createPacer", () => {
  it("lets the first turn start at once and spaces the rest", async () => {
    const turn = createPacer(500);
    const starts: number[] = [];
    const run = async () => {
      await turn();
      starts.push(Date.now());
    };
    const all = Promise.all([run(), run(), run()]);
    await vi.advanceTimersByTimeAsync(2000);
    await all;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(500);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(500);
  });
});
