import { and, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { runs, traceEvents, type RunStage, type TraceLevel } from "@/src/db/schema";
import { createBatcher, flushAllWrites, type Batcher } from "@/src/lib/batcher";

export type RunRecord = typeof runs.$inferSelect;

// Everything the runner needs from storage. The real one is Postgres; tests use the in-memory one.
export interface RunRepo {
  getRun(runId: string): Promise<RunRecord | null>;
  // Atomically takes the run's current stage: pending to running, or a running stage that has gone stale.
  // Returns null when there is nothing to claim (finished, failed, or another request is on it).
  claimStage(runId: string, staleAfterMs: number): Promise<RunRecord | null>;
  completeStage(runId: string, next: RunStage): Promise<void>;
  failRun(runId: string, message: string): Promise<void>;
  addTrace(runId: string, stage: RunStage, level: TraceLevel, message: string, data?: unknown): Promise<void>;
}

type TraceRowInsert = typeof traceEvents.$inferInsert;

// One batcher per database connection, so every repo instance shares it and trace lines stay in order.
const traceBatchers = new WeakMap<Db, Batcher<TraceRowInsert>>();
function traceBatcher(db: Db): Batcher<TraceRowInsert> {
  let batcher = traceBatchers.get(db);
  if (!batcher) {
    batcher = createBatcher(async (rows) => {
      await db.insert(traceEvents).values(rows);
    });
    traceBatchers.set(db, batcher);
  }
  return batcher;
}

// The number of Qloo calls a run made, counted from the call log when a stage ends. (Counting per call would cost
// a database write for every Qloo request.)
const qlooCallsMade = (runId: string) => sql<number>`(select count(*)::int from qloo_calls where run_id = ${runId})`;

export function createDbRunRepo(db: Db, now: () => number = Date.now): RunRepo {
  return {
    async getRun(runId) {
      const [row] = await db.select().from(runs).where(eq(runs.id, runId));
      return row ?? null;
    },

    async claimStage(runId, staleAfterMs) {
      const [row] = await db
        .update(runs)
        .set({ status: "running", stageStartedAt: new Date(now()) })
        .where(
          and(
            eq(runs.id, runId),
            or(
              eq(runs.status, "pending"),
              and(eq(runs.status, "running"), lt(runs.stageStartedAt, new Date(now() - staleAfterMs))),
            ),
          ),
        )
        .returning();
      return row ?? null;
    },

    async completeStage(runId, next) {
      // The stage's trace lines and call log must be saved before the page is told the stage is done.
      await flushAllWrites();
      const finished = next === "done";
      await db
        .update(runs)
        .set({
          stage: next,
          status: finished ? "done" : "pending",
          stageStartedAt: null,
          finishedAt: finished ? new Date(now()) : null,
          qlooCallCount: qlooCallsMade(runId),
        })
        .where(eq(runs.id, runId));
    },

    async failRun(runId, message) {
      await flushAllWrites();
      await db
        .update(runs)
        .set({
          status: "error",
          error: message,
          stageStartedAt: null,
          finishedAt: new Date(now()),
          qlooCallCount: qlooCallsMade(runId),
        })
        .where(eq(runs.id, runId));
    },

    async addTrace(runId, stage, level, message, data) {
      traceBatcher(db).add({ runId, stage, level, message, data: data ?? null });
    },
  };
}

export type TraceRow = { runId: string; stage: RunStage; level: TraceLevel; message: string; data?: unknown };

export type MemoryRunRepo = RunRepo & {
  runs: Map<string, RunRecord>;
  traces: TraceRow[];
  addRun(partial?: Partial<RunRecord>): RunRecord;
};

export function createMemoryRunRepo(now: () => number = Date.now): MemoryRunRepo {
  const store = new Map<string, RunRecord>();
  const traces: TraceRow[] = [];
  let counter = 0;

  const update = (runId: string, patch: Partial<RunRecord>) => {
    const current = store.get(runId);
    if (current) store.set(runId, { ...current, ...patch });
  };

  return {
    runs: store,
    traces,

    addRun(partial = {}) {
      counter += 1;
      const run: RunRecord = {
        id: `run-${counter}`,
        venueId: `venue-${counter}`,
        status: "pending",
        stage: "locate",
        radiusM: null,
        qlooMode: "fixtures",
        qlooCallCount: 0,
        llmCallCount: 0,
        startedAt: new Date(now()),
        stageStartedAt: null,
        finishedAt: null,
        error: null,
        ...partial,
      };
      store.set(run.id, run);
      return run;
    },

    async getRun(runId) {
      return store.get(runId) ?? null;
    },

    // No await between the check and the write, so two callers cannot both claim.
    async claimStage(runId, staleAfterMs) {
      const run = store.get(runId);
      if (!run) return null;
      const stale =
        run.status === "running" && run.stageStartedAt !== null && run.stageStartedAt.getTime() < now() - staleAfterMs;
      if (run.status !== "pending" && !stale) return null;
      update(runId, { status: "running", stageStartedAt: new Date(now()) });
      return store.get(runId) ?? null;
    },

    async completeStage(runId, next) {
      const finished = next === "done";
      update(runId, {
        stage: next,
        status: finished ? "done" : "pending",
        stageStartedAt: null,
        finishedAt: finished ? new Date(now()) : null,
      });
    },

    async failRun(runId, message) {
      update(runId, { status: "error", error: message, stageStartedAt: null, finishedAt: new Date(now()) });
    },

    async addTrace(runId, stage, level, message, data) {
      traces.push({ runId, stage, level, message, data });
    },
  };
}
