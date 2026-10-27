import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { baselines, candidates, llmOutputs, qlooCalls, runs, traceEvents, venues } from "@/src/db/schema";
import type { RunStage, TraceLevel } from "@/src/db/schema";
import type { PoolRef } from "@/src/agent/designer/candidates";
import type { Breakdown, ComponentName } from "@/src/scoring/clubScore";
import { COMPONENTS } from "@/src/scoring/clubScore";

// What the pages read. All plain data, no raw errors: the run page polls getRunState and the picks page reads getCandidates.

export type TraceView = { id: number; stage: RunStage; level: TraceLevel; message: string; data: unknown; at: string };

export type VenueView = {
  id: string;
  name: string;
  address: string;
  matchedAddress: string | null;
  lat: number;
  lon: number;
  venueType: string;
  slowNight: string;
  qlooEntityName: string | null;
  isDemo: boolean;
};

export type RunStateView = {
  run: {
    id: string;
    status: "pending" | "running" | "done" | "error";
    stage: RunStage;
    error: string | null;
    qlooMode: "fixtures" | "live" | "record";
    startedAt: string;
    finishedAt: string | null;
    radiusM: number | null;
  };
  venue: VenueView;
  events: TraceView[];
  cursor: number;
  counters: { qlooCalls: number; llmCalls: number; elapsedMs: number };
};

// The internal "detail" a failed stage keeps for debugging is removed before anything leaves the server.
export function publicTraceData(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data) && "detail" in data) {
    const rest = { ...(data as Record<string, unknown>) };
    delete rest.detail;
    return Object.keys(rest).length ? rest : null;
  }
  return data ?? null;
}

const venueView = (v: typeof venues.$inferSelect): VenueView => ({
  id: v.id,
  name: v.name,
  address: v.address,
  matchedAddress: v.matchedAddress,
  lat: v.lat,
  lon: v.lon,
  venueType: v.venueType,
  slowNight: v.slowNight,
  qlooEntityName: v.qlooEntityName,
  isDemo: v.isDemo,
});

export async function getRunState(db: Db, runId: string, afterEventId = 0, now: number = Date.now()): Promise<RunStateView | null> {
  const [row] = await db.select({ run: runs, venue: venues }).from(runs).innerJoin(venues, eq(venues.id, runs.venueId)).where(eq(runs.id, runId));
  if (!row) return null;

  const events = await db
    .select()
    .from(traceEvents)
    .where(and(eq(traceEvents.runId, runId), gt(traceEvents.id, afterEventId)))
    .orderBy(asc(traceEvents.id));

  const [{ qlooCalls: qlooCount }] = await db
    .select({ qlooCalls: sql<number>`count(*)::int` })
    .from(qlooCalls)
    .where(eq(qlooCalls.runId, runId));
  const [{ llmCalls }] = await db
    .select({ llmCalls: sql<number>`count(*)::int` })
    .from(llmOutputs)
    .where(eq(llmOutputs.runId, runId));

  const { run } = row;
  const end = run.finishedAt?.getTime() ?? now;
  return {
    run: {
      id: run.id,
      status: run.status,
      stage: run.stage,
      error: run.error,
      qlooMode: run.qlooMode,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      radiusM: run.radiusM,
    },
    venue: venueView(row.venue),
    events: events.map((e) => ({ id: e.id, stage: e.stage, level: e.level, message: e.message, data: publicTraceData(e.data), at: e.createdAt.toISOString() })),
    cursor: events.at(-1)?.id ?? afterEventId,
    counters: { qlooCalls: qlooCount, llmCalls, elapsedMs: Math.max(0, end - run.startedAt.getTime()) },
  };
}

// ---- picks ----

export type EvidenceCall = {
  id: string;
  purpose: string;
  endpoint: string;
  params: unknown;
  status: number;
  ms: number;
  resultCount: number | null;
  cached: boolean;
};

export type ComponentView = { name: ComponentName; weight: number; value: number; reason: string; flagged: boolean; calls: EvidenceCall[] };

export type CandidateView = {
  id: string;
  rank: number | null;
  title: string;
  format: string;
  why: string;
  anchor: PoolRef;
  companions: PoolRef[];
  score: number | null;
  verified: boolean;
  components: ComponentView[];
};

export type HeatLayer = { source: "qloo_heatmap" | "nearby_places"; points: Array<{ lat: number; lon: number; affinity?: number }>; callId: string | null };

export type CandidatesView = {
  run: RunStateView["run"];
  venue: VenueView;
  candidates: CandidateView[];
  baseline: { ideas: string[]; verdict: string | null } | null;
  heat: HeatLayer | null;
  counters: RunStateView["counters"];
};

type StoredBreakdown = Partial<Record<ComponentName, Breakdown[ComponentName]>> & { heat?: HeatLayer };

const WEIGHT_OF: Record<ComponentName, number> = { localAffinity: 0.3, coherence: 0.2, venueFit: 0.15, momentum: 0.1, sweetSpot: 0.15, formatFit: 0.1 };

// Joins each component's call ids to the rows of the call log, so "How we know" shows real calls.
export function shapeCandidates(
  rows: Array<typeof candidates.$inferSelect>,
  calls: Map<string, EvidenceCall>,
): { candidates: CandidateView[]; heat: HeatLayer | null } {
  let heat: HeatLayer | null = null;
  const ranked = [...rows].sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (b.score ?? 0) - (a.score ?? 0));
  const shaped = ranked.map((row): CandidateView => {
    const breakdown = (row.breakdown ?? {}) as StoredBreakdown;
    if (breakdown.heat && !heat) heat = breakdown.heat;
    const components = COMPONENTS.flatMap((name): ComponentView[] => {
      const part = breakdown[name];
      if (!part) return [];
      return [
        {
          name,
          weight: WEIGHT_OF[name],
          value: part.value,
          reason: part.reason,
          flagged: part.flagged === true,
          calls: part.callIds.flatMap((id) => {
            const call = calls.get(id);
            return call ? [call] : [];
          }),
        },
      ];
    });
    return { id: row.id, rank: row.rank, title: row.title, format: row.format, why: row.why, anchor: row.anchor as PoolRef, companions: row.companions as PoolRef[], score: row.score, verified: row.verified, components };
  });
  return { candidates: shaped, heat };
}

export async function getCandidates(db: Db, runId: string, now: number = Date.now()): Promise<CandidatesView | null> {
  const state = await getRunState(db, runId, Number.MAX_SAFE_INTEGER, now);
  if (!state) return null;

  const rows = await db.select().from(candidates).where(eq(candidates.runId, runId));
  const wanted = new Set<string>();
  for (const row of rows) {
    const breakdown = (row.breakdown ?? {}) as StoredBreakdown;
    for (const name of COMPONENTS) for (const id of breakdown[name]?.callIds ?? []) wanted.add(id);
    if (breakdown.heat?.callId) wanted.add(breakdown.heat.callId);
  }

  const calls = new Map<string, EvidenceCall>();
  if (wanted.size > 0) {
    const found = await db.select().from(qlooCalls).where(inArray(qlooCalls.id, [...wanted]));
    for (const c of found) {
      calls.set(c.id, { id: c.id, purpose: c.purpose, endpoint: c.endpoint, params: c.params, status: c.status, ms: c.ms, resultCount: c.resultCount, cached: c.cached });
    }
  }

  const { candidates: shaped, heat } = shapeCandidates(rows, calls);
  const [base] = await db.select().from(baselines).where(eq(baselines.runId, runId));
  return {
    run: state.run,
    venue: state.venue,
    candidates: shaped,
    baseline: base ? { ideas: base.ideas as string[], verdict: base.verdict } : null,
    heat,
    counters: state.counters,
  };
}
