import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/src/config/env";
import { createQlooClient, QlooError, type QlooClientDeps } from "@/src/qloo/client";
import { createMemoryStore } from "@/src/qloo/store";

// Rules from the official hackathon developer guide (docs/QLOO_API.md section 0).

const ctx = { purpose: "scout.area_entities" as const };
const ok = () => new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });

function setup(overrides: Partial<QlooClientDeps> = {}, response: () => Response = ok) {
  const store = createMemoryStore();
  const fetchMock = vi.fn(async () => response());
  const client = createQlooClient({
    mode: "live",
    baseUrl: "https://qloo.test",
    apiKey: "k",
    store,
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
  return { client, store, fetchMock };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("allowed endpoints", () => {
  it.each(["/recommendations", "/recs", "/v2/recs", "/v2/recommendations", "/anything-else"])(
    "refuses %s without calling Qloo",
    async (endpoint) => {
      const { client, fetchMock } = setup();
      await expect(client.get(endpoint, {}, ctx)).rejects.toThrow(/not allowed/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["/search", "/entities", "/v2/tags", "/v2/insights", "/v2/analysis/compare"])("accepts %s", async (endpoint) => {
    const { client } = setup({ mode: "fixtures", fixtures: () => ({}) });
    await expect(client.get(endpoint, {}, ctx)).resolves.toMatchObject({ status: 200 });
  });

  it("only ever sends GET with the key in the X-Api-Key header", async () => {
    const calls: Array<{ method?: string; headers: Record<string, string> }> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ method: init?.method, headers: init?.headers as Record<string, string> });
      return ok();
    });
    const { client } = setup({ fetch: fetchMock as unknown as typeof fetch });
    const result = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(calls[0].method ?? "GET").toBe("GET");
    expect(calls[0].headers["X-Api-Key"]).toBe("k");
  });
});

describe("cache lifetime", () => {
  async function expiresAfter(endpoint: string): Promise<number> {
    const { client, store } = setup();
    const started = Date.now();
    const result = client.get(endpoint, { q: "x" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await result;
    const [entry] = [...store.cache.values()];
    return Math.round((entry.expiresAt.getTime() - started) / 3_600_000);
  }

  it("keeps search, entity and tag lookups for 7 days", async () => {
    expect(await expiresAfter("/search")).toBe(168);
    expect(await expiresAfter("/entities")).toBe(168);
    expect(await expiresAfter("/v2/tags")).toBe(168);
  });

  it("keeps insights for 24 hours", async () => {
    expect(await expiresAfter("/v2/insights")).toBe(24);
  });

  it("still serves a search from the cache after 6 days", async () => {
    const { client, fetchMock } = setup();
    const first = client.get("/search", { query: "x" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    await vi.advanceTimersByTimeAsync(6 * 24 * 3_600_000);
    expect((await client.get("/search", { query: "x" }, ctx)).cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("parameters in the response", () => {
  it("returns the full cleaned parameter set so an empty result can be debugged", async () => {
    const { client } = setup();
    const result = client.get("/v2/insights", { b: 2, a: "1", skipped: undefined }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    expect((await result).params).toEqual({ a: "1", b: "2" });
  });

  it("returns params for cache hits and fixtures too", async () => {
    const { client } = setup();
    const first = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    expect((await client.get("/v2/insights", { a: "1" }, ctx)).params).toEqual({ a: "1" });
    const offline = setup({ mode: "fixtures", fixtures: () => ({}) });
    expect((await offline.client.get("/search", { q: "z" }, ctx)).params).toEqual({ q: "z" });
  });

  it("stores the parameters of an empty answer in the call log", async () => {
    const { client, store } = setup();
    const result = client.get("/v2/insights", { "filter.type": "urn:entity:movie" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(store.calls[0]).toMatchObject({ params: { "filter.type": "urn:entity:movie" }, resultCount: 0 });
  });
});

describe("403", () => {
  it("is reported as an unsupported request with status 403", async () => {
    const { client } = setup({}, () => new Response("{}", { status: 403 }));
    const failing = client.get("/v2/insights", { "filter.type": "urn:tag" }, ctx).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    const error = (await failing) as QlooError;
    expect(error).toBeInstanceOf(QlooError);
    expect(error.status).toBe(403);
    expect(error.message).toMatch(/does not allow/);
  });
});

describe("record mode", () => {
  const base = { DATABASE_URL: "postgres://x", QLOO_MODE: "record", QLOO_API_KEY: "k" };

  it("works on a developer machine", () => {
    expect(parseEnv(base).QLOO_MODE).toBe("record");
  });

  it("is refused on Vercel, because recordings must never leave a developer machine", () => {
    expect(() => parseEnv({ ...base, VERCEL: "1" })).toThrow(/record mode is for local use only/);
  });

  it("live mode is fine on Vercel", () => {
    expect(parseEnv({ ...base, QLOO_MODE: "live", VERCEL: "1" }).QLOO_MODE).toBe("live");
  });
});

describe("Qloo data stays out of the public repo", () => {
  const root = process.cwd();

  it("git-ignores fixtures/live/", () => {
    const lines = readFileSync(path.join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim());
    expect(lines).toContain("fixtures/live/");
  });

  it("keeps only hand-written sample data in fixtures/sample", () => {
    const catalogue = JSON.parse(readFileSync(path.join(root, "fixtures/sample/catalogue.json"), "utf8"));
    expect(catalogue._note).toMatch(/Not real Qloo output/);
    const locations = JSON.parse(readFileSync(path.join(root, "fixtures/sample/locations.json"), "utf8"));
    expect(locations._note).toMatch(/Not real Qloo output/);
  });
});
