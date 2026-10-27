import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createRun, createRunSchema, type CreateRunDeps } from "@/src/runs/createRun";
import { clientIp, handleRoute, HttpError, requireUuid } from "@/src/runs/http";
import { checkRateLimit, createMemoryRateStore } from "@/src/runs/rateLimit";
import { publicTraceData, shapeCandidates, type EvidenceCall } from "@/src/runs/state";
import { UserFacingError } from "@/src/lib/errors";
import type { candidates } from "@/src/db/schema";

const valid = { name: "Corner Cafe", address: "100 Crosby St, New York, NY", venueType: "cafe", slowNight: "tuesday" } as const;

describe("createRunSchema", () => {
  it("accepts the landing form and trims text", () => {
    expect(createRunSchema.parse({ ...valid, name: "  Corner Cafe " }).name).toBe("Corner Cafe");
  });

  it("explains what is missing in plain words", () => {
    const result = createRunSchema.safeParse({ ...valid, slowNight: "someday" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Pick your slowest night.");
  });

  it("wants latitude and longitude together", () => {
    expect(createRunSchema.safeParse({ ...valid, lat: 40.7 }).success).toBe(false);
    expect(createRunSchema.safeParse({ ...valid, lat: 40.7, lon: -74 }).success).toBe(true);
  });

  it("rejects coordinates off the planet", () => {
    expect(createRunSchema.safeParse({ ...valid, lat: 120, lon: 0 }).success).toBe(false);
  });
});

function deps(found: Awaited<ReturnType<CreateRunDeps["geocode"]>>) {
  const geocoded: string[] = [];
  const saved: Array<Parameters<CreateRunDeps["save"]>[0]> = [];
  const d: CreateRunDeps = {
    qlooMode: "fixtures",
    geocode: async (address) => {
      geocoded.push(address);
      return found;
    },
    save: async (args) => {
      saved.push(args);
      return { runId: "r1", venueId: "v1" };
    },
  };
  return { d, geocoded, saved };
}

describe("createRun", () => {
  const match = { lat: 40.72, lon: -73.99, displayName: "100 Crosby St, Manhattan", alternatives: [{ lat: 1, lon: 2, displayName: "Other" }] };

  it("looks the address up and saves the match with its alternatives", async () => {
    const { d, geocoded, saved } = deps(match);
    const created = await createRun(valid, d);
    expect(geocoded).toEqual(["100 Crosby St, New York, NY"]);
    expect(created).toMatchObject({ runId: "r1", venueId: "v1", location: { lat: 40.72, source: "geocoded" } });
    expect(saved[0].location.alternatives).toHaveLength(1);
    expect(saved[0].qlooMode).toBe("fixtures");
  });

  it("skips the lookup when the person already picked a spot", async () => {
    const { d, geocoded } = deps(match);
    const created = await createRun({ ...valid, lat: 41.9, lon: -87.7, matchedAddress: "Logan Square" }, d);
    expect(geocoded).toEqual([]);
    expect(created.location).toMatchObject({ lat: 41.9, lon: -87.7, displayName: "Logan Square", source: "given" });
  });

  it("says so in plain words when the address cannot be found, and saves nothing", async () => {
    const { d, saved } = deps(null);
    await expect(createRun(valid, d)).rejects.toMatchObject({ status: 422, message: expect.stringContaining("could not find that address") });
    expect(saved).toEqual([]);
  });

  it("rejects bad input before any lookup", async () => {
    const { d, geocoded } = deps(match);
    await expect(createRun({ ...valid, name: "" }, d)).rejects.toBeInstanceOf(ZodError);
    expect(geocoded).toEqual([]);
  });
});

describe("rate limit", () => {
  it("allows the limit, then refuses, and tells the caller how long to wait", async () => {
    const store = createMemoryRateStore();
    const now = Date.UTC(2026, 9, 27, 10, 15, 0);
    for (let i = 0; i < 3; i++) expect((await checkRateLimit(store, "ip", 3, now)).allowed).toBe(true);
    const refused = await checkRateLimit(store, "ip", 3, now);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(45 * 60);
  });

  it("counts each caller separately and starts fresh in the next hour", async () => {
    const store = createMemoryRateStore();
    const now = Date.UTC(2026, 9, 27, 10, 15, 0);
    await checkRateLimit(store, "a", 1, now);
    expect((await checkRateLimit(store, "b", 1, now)).allowed).toBe(true);
    expect((await checkRateLimit(store, "a", 1, now)).allowed).toBe(false);
    expect((await checkRateLimit(store, "a", 1, now + 60 * 60 * 1000)).allowed).toBe(true);
  });
});

describe("http helpers", () => {
  it("reads the caller from the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("treats anything that is not a uuid as a run that does not exist", () => {
    expect(() => requireUuid("nope")).toThrowError(HttpError);
    expect(requireUuid("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("maps errors to plain JSON and never leaks an internal message", async () => {
    const limited = await handleRoute(async () => {
      throw new HttpError(429, "Slow down.", { retryAfterSeconds: 90 });
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("90");
    expect(await limited.json()).toEqual({ error: "Slow down.", retryAfterSeconds: 90 });

    const invalid = await handleRoute(async () => {
      createRunSchema.parse({ ...valid, name: "" });
      return new Response();
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("name");

    const upstream = await handleRoute(async () => {
      throw new UserFacingError("Qloo is not answering.");
    });
    expect(upstream.status).toBe(502);

    const internal = await handleRoute(async () => {
      throw new Error("password=hunter2 at db.ts:12");
    });
    expect(internal.status).toBe(500);
    expect(JSON.stringify(await internal.json())).not.toContain("hunter2");
  });
});

describe("trace data sent to the page", () => {
  it("removes the internal detail of a failure and keeps the rest", () => {
    expect(publicTraceData({ detail: "stack at line 3", provider: "google" })).toEqual({ provider: "google" });
    expect(publicTraceData({ detail: "only this" })).toBeNull();
    expect(publicTraceData({ n: 1 })).toEqual({ n: 1 });
    expect(publicTraceData(undefined)).toBeNull();
  });
});

describe("shapeCandidates", () => {
  const row = (id: string, rank: number | null, breakdown: unknown): typeof candidates.$inferSelect => ({
    id,
    runId: "run",
    title: `Club ${id}`,
    anchor: { refId: "fx_1", name: "A" },
    companions: [],
    format: "listening_night",
    why: "because",
    score: rank === null ? null : 100 - rank,
    breakdown,
    rank,
    verified: rank !== null,
  });
  const call: EvidenceCall = { id: "c1", purpose: "verify.coherence", endpoint: "/v2/insights", params: { a: 1 }, status: 200, ms: 120, resultCount: 5, cached: false };

  it("orders by rank, puts unranked last, and joins each component to its real Qloo calls", () => {
    const withCalls = {
      coherence: { value: 0.8, reason: "They overlap.", callIds: ["c1", "missing"] },
      localAffinity: { value: 0.6, reason: "Popular here.", callIds: [], flagged: true },
      heat: { source: "qloo_heatmap", points: [{ lat: 1, lon: 2 }], callId: "c1" },
    };
    const { candidates: shaped, heat } = shapeCandidates([row("b", null, null), row("a", 1, withCalls)], new Map([["c1", call]]));
    expect(shaped.map((c) => c.id)).toEqual(["a", "b"]);
    expect(shaped[0].components.map((c) => c.name)).toEqual(["localAffinity", "coherence"]);
    expect(shaped[0].components[1]).toMatchObject({ weight: 0.2, calls: [call] });
    expect(shaped[0].components[0].flagged).toBe(true);
    expect(shaped[1].components).toEqual([]);
    expect(heat?.points).toHaveLength(1);
  });
});
