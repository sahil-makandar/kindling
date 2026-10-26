import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/src/config/env";
import { getDb } from "@/src/db/client";
import { fixtureResponse } from "./fixtures";
import { countResults } from "./schemas";
import { createDbStore, type QlooStore } from "./store";

// The only place that talks to Qloo. Everything else goes through qlooGet (see docs/QLOO_API.md).

export type QlooMode = "fixtures" | "live" | "record";

// What a call is for. Shown in the "How we know" panel and used to name recordings.
export type QlooPurpose =
  | "locate.venue"
  | "scout.area_entities"
  | "scout.area_tags"
  | "scout.venue_crowd"
  | "scout.trending"
  | "scout.places"
  | "verify.coherence"
  | "verify.local_strength"
  | "verify.heatmap"
  | "checkin.search"
  | "checkin.tags"
  | "coach.room_tags"
  | "coach.adjacent"
  | "spike";

export type QlooContext = { runId?: string; purpose: QlooPurpose };
export type QlooParams = Record<string, string | number | boolean | undefined>;

export type QlooResponse = {
  data: unknown;
  // Row in qloo_calls, so a signal can point at the call that produced it.
  callId: string | null;
  status: number;
  ms: number;
  cached: boolean;
};

export type QlooGet = (path: string, params: QlooParams, ctx: QlooContext) => Promise<QlooResponse>;

export class QlooError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "QlooError";
  }
}

export type QlooClientDeps = {
  mode: QlooMode;
  baseUrl: string;
  apiKey?: string;
  store: QlooStore;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  // Used by fixtures mode. Defaults to the sample fixtures.
  fixtures?: (path: string, params: Record<string, string>) => unknown;
  // Used by record mode. Defaults to writing under fixtures/live/.
  record?: (fileName: string, payload: unknown) => Promise<void>;
  paceMs?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function cleanParams(params: QlooParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function writeRecording(fileName: string, payload: unknown): Promise<void> {
  const dir = path.join(process.cwd(), "fixtures", "live");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), JSON.stringify(payload, null, 2) + "\n");
}

export function createQlooClient(deps: QlooClientDeps): { get: QlooGet } {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const paceMs = deps.paceMs ?? 340;
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const retryDelayMs = deps.retryDelayMs ?? 1500;
  const cacheTtlMs = deps.cacheTtlMs ?? DAY_MS;
  const fixtures = deps.fixtures ?? fixtureResponse;
  const record = deps.record ?? writeRecording;

  // One request every paceMs, in the order they were asked for.
  let queue: Promise<void> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  function pace(): Promise<void> {
    const turn = queue.then(async () => {
      const wait = lastStart + paceMs - now();
      if (wait > 0) await sleep(wait);
      lastStart = now();
    });
    queue = turn.catch(() => undefined);
    return turn;
  }

  async function fetchOnce(url: string): Promise<{ status: number; body: unknown }> {
    await pace();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        headers: { "X-Api-Key": deps.apiKey ?? "", Accept: "application/json" },
        signal: controller.signal,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "AbortError";
      throw new QlooError(timedOut ? "Qloo took too long to answer." : "Could not reach Qloo.", 0);
    } finally {
      clearTimeout(timer);
    }
  }

  // Never throws: a broken log must not break a run.
  async function log(
    ctx: QlooContext,
    endpoint: string,
    params: Record<string, string>,
    status: number,
    ms: number,
    data: unknown,
    cached: boolean,
  ): Promise<string | null> {
    try {
      return await deps.store.logCall({
        runId: ctx.runId,
        purpose: ctx.purpose,
        endpoint,
        params,
        status,
        ms,
        resultCount: countResults(data),
        cached,
      });
    } catch {
      return null;
    }
  }

  const get: QlooGet = async (endpoint, rawParams, ctx) => {
    const params = cleanParams(rawParams);
    const started = now();

    if (deps.mode === "fixtures") {
      const data = fixtures(endpoint, params);
      const ms = now() - started;
      return { data, callId: await log(ctx, endpoint, params, 200, ms, data, false), status: 200, ms, cached: false };
    }

    const query = new URLSearchParams(params).toString();
    const requestKey = `GET ${endpoint}?${query}`;
    const key = sha256(requestKey);

    try {
      const hit = await deps.store.getCache(key);
      if (hit !== undefined) {
        return { data: hit, callId: await log(ctx, endpoint, params, 200, 0, hit, true), status: 200, ms: 0, cached: true };
      }
    } catch {
      // A cache outage only costs us a live call.
    }

    const url = `${deps.baseUrl}${endpoint}${query ? `?${query}` : ""}`;
    let result: { status: number; body: unknown };
    try {
      result = await fetchOnce(url);
      if (result.status === 429) {
        await sleep(retryDelayMs);
        result = await fetchOnce(url);
      }
    } catch (e) {
      const ms = now() - started;
      await log(ctx, endpoint, params, e instanceof QlooError ? e.status : 0, ms, null, false);
      throw e;
    }

    const ms = now() - started;
    const callId = await log(ctx, endpoint, params, result.status, ms, result.body, false);

    if (result.status < 200 || result.status >= 300) {
      throw new QlooError(
        result.status === 429 ? "Qloo is rate limiting us right now." : `Qloo answered with status ${result.status}.`,
        result.status,
      );
    }

    try {
      await deps.store.setCache(key, result.body, new Date(now() + cacheTtlMs));
    } catch {
      // Not caching is fine.
    }
    if (deps.mode === "record") {
      await record(`${ctx.purpose}-${key.slice(0, 10)}.json`, {
        request: { path: endpoint, params },
        status: result.status,
        response: result.body,
      });
    }
    return { data: result.body, callId, status: result.status, ms, cached: false };
  };

  return { get };
}

// One shared client per process, so pacing holds across requests and hot reloads.
const globalForQloo = globalThis as unknown as { __qloo?: { get: QlooGet } };

export const qlooGet: QlooGet = (endpoint, params, ctx) => {
  if (!globalForQloo.__qloo) {
    const env = getEnv();
    globalForQloo.__qloo = createQlooClient({
      mode: env.QLOO_MODE,
      baseUrl: env.QLOO_BASE_URL,
      apiKey: env.QLOO_API_KEY,
      store: createDbStore(getDb()),
    });
  }
  return globalForQloo.__qloo.get(endpoint, params, ctx);
};
