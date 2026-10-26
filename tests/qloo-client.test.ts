import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQlooClient, QlooError, type QlooClientDeps } from "@/src/qloo/client";
import { createMemoryStore } from "@/src/qloo/store";

const ctx = { purpose: "scout.area_entities" as const, runId: "run-1" };
const ok = (body: unknown = { results: { entities: [{}, {}] } }) =>
  new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response("{}", { status: code });

function setup(overrides: Partial<QlooClientDeps> & { responses?: Array<() => Response> } = {}) {
  const store = createMemoryStore();
  const calls: Array<{ url: string; at: number; headers: HeadersInit | undefined }> = [];
  const queue = overrides.responses ?? [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), at: Date.now(), headers: init?.headers });
    return (queue.shift() ?? ok)();
  });
  const client = createQlooClient({
    mode: "live",
    baseUrl: "https://qloo.test",
    apiKey: "secret-key-123",
    store,
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
  return { client, store, fetchMock, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pacing", () => {
  it("starts requests in order, at least 340 ms apart", async () => {
    const { client, calls } = setup();
    const all = Promise.all([
      client.get("/v2/insights", { n: 1 }, ctx),
      client.get("/v2/insights", { n: 2 }, ctx),
      client.get("/v2/insights", { n: 3 }, ctx),
    ]);
    await vi.advanceTimersByTimeAsync(2000);
    await all;

    expect(calls.map((c) => new URL(c.url).searchParams.get("n"))).toEqual(["1", "2", "3"]);
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(340);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(340);
  });
});

describe("cache", () => {
  it("serves a repeat call from the cache without fetching", async () => {
    const { client, fetchMock, store } = setup();
    const first = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    expect((await first).cached).toBe(false);

    const second = await client.get("/v2/insights", { a: "1" }, ctx);
    expect(second.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.calls.map((c) => c.cached)).toEqual([false, true]);
  });

  it("treats the same params in a different order as one request", async () => {
    const { client, fetchMock } = setup();
    const first = client.get("/v2/insights", { a: "1", b: "2" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    await client.get("/v2/insights", { b: "2", a: "1" }, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches again after 24 hours", async () => {
    const { client, fetchMock } = setup();
    const first = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await first;
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);
    const again = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await again;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const { client, store } = setup({ responses: [() => status(400)] });
    const failing = client.get("/v2/insights", { a: "1" }, ctx).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(await failing).toBeInstanceOf(QlooError);
    expect(store.cache.size).toBe(0);
  });
});

describe("errors and retries", () => {
  it("retries once after a 429 and then succeeds", async () => {
    const { client, fetchMock } = setup({ responses: [() => status(429), () => ok()] });
    const result = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await result).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 429 with a readable error", async () => {
    const { client, fetchMock } = setup({ responses: [() => status(429), () => status(429)] });
    const result = client.get("/v2/insights", { a: "1" }, ctx).catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000);
    const error = await result;
    expect(error).toBeInstanceOf(QlooError);
    expect((error as QlooError).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry other 4xx errors, and logs them", async () => {
    const { client, fetchMock, store } = setup({ responses: [() => status(400)] });
    const result = client.get("/v2/insights", { a: "1" }, ctx).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    expect(((await result) as QlooError).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.calls[0].status).toBe(400);
  });

  it("times out after 15 seconds", async () => {
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
    const { client } = setup({ fetch: hang as unknown as typeof fetch });
    const result = client.get("/v2/insights", { a: "1" }, ctx).catch((e) => e);
    await vi.advanceTimersByTimeAsync(15_100);
    const error = (await result) as QlooError;
    expect(error).toBeInstanceOf(QlooError);
    expect(error.message).toMatch(/too long/);
  });
});

describe("logging and secrets", () => {
  it("logs purpose, endpoint, params, status and result count for the run", async () => {
    const { client, store } = setup();
    const result = client.get("/v2/insights", { "filter.type": "urn:tag", take: 5, skipped: undefined }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(store.calls[0]).toMatchObject({
      runId: "run-1",
      purpose: "scout.area_entities",
      endpoint: "/v2/insights",
      params: { "filter.type": "urn:tag", take: "5" },
      status: 200,
      resultCount: 2,
      cached: false,
    });
    expect(store.calls[0].params).not.toHaveProperty("skipped");
  });

  it("sends the key only as a header and never logs it", async () => {
    const { client, store, calls } = setup({ responses: [() => status(500)] });
    const failing = client.get("/v2/insights", { a: "1" }, ctx).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10);
    const error = (await failing) as Error;

    expect(JSON.stringify(calls[0].headers)).toContain("secret-key-123");
    expect(calls[0].url).not.toContain("secret-key-123");
    expect(JSON.stringify(store.calls)).not.toContain("secret-key-123");
    expect(error.message).not.toContain("secret-key-123");
  });

  it("keeps working when the log store fails", async () => {
    const { client, store } = setup();
    store.logCall = async () => {
      throw new Error("db down");
    };
    const result = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    expect((await result).callId).toBeNull();
  });
});

describe("modes", () => {
  it("fixtures mode never calls fetch and still logs the call", async () => {
    const { client, fetchMock, store } = setup({
      mode: "fixtures",
      fixtures: () => ({ results: { entities: [{}, {}, {}] } }),
    });
    const res = await client.get("/v2/insights", { a: "1" }, ctx);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(store.calls[0]).toMatchObject({ status: 200, resultCount: 3, cached: false });
    expect(store.cache.size).toBe(0);
  });

  it("record mode saves the raw response", async () => {
    const record = vi.fn(async () => undefined);
    const { client } = setup({ mode: "record", record });
    const result = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(record).toHaveBeenCalledTimes(1);
    const [fileName, payload] = record.mock.calls[0] as unknown as [string, { request: unknown; response: unknown }];
    expect(fileName).toMatch(/^scout\.area_entities-[0-9a-f]{10}\.json$/);
    expect(payload.request).toEqual({ path: "/v2/insights", params: { a: "1" } });
    expect(payload.response).toEqual({ results: { entities: [{}, {}] } });
  });

  it("live mode does not record", async () => {
    const record = vi.fn(async () => undefined);
    const { client } = setup({ mode: "live", record });
    const result = client.get("/v2/insights", { a: "1" }, ctx);
    await vi.advanceTimersByTimeAsync(10);
    await result;
    expect(record).not.toHaveBeenCalled();
  });
});
