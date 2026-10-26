import type { RunStage } from "@/src/db/schema";
import { UserFacingError } from "@/src/lib/errors";
import type { RunRecord, RunRepo } from "./runRepo";
import { createTracer, type Tracer } from "./trace";

// The run state machine. One call to advanceRun runs exactly one stage, so each stage is its own
// short request. The page keeps calling until the run is done.

export type RunnableStage = Exclude<RunStage, "done">;

export const STAGE_ORDER: readonly RunnableStage[] = ["locate", "scout", "design", "verify", "baseline"];

// A critical stage stops the run when it fails: later stages cannot work without its output.
// The others are skipped with an error line and the run carries on with what it has.
export const STAGE_CRITICAL: Record<RunnableStage, boolean> = {
  locate: false, // no venue match just means we read the neighbourhood instead
  scout: true,
  design: true,
  verify: false, // candidates stay unverified and the page says so
  baseline: false, // the "Without Qloo" panel is a bonus
};

const STAGE_LABEL: Record<RunnableStage, string> = {
  locate: "finding your venue",
  scout: "reading the neighbourhood",
  design: "designing clubs",
  verify: "checking the clubs",
  baseline: "writing the comparison without Qloo",
};

export type StageContext = { run: RunRecord; trace: Tracer };
export type StageFn = (ctx: StageContext) => Promise<void>;

export type AdvanceResult = {
  runId: string;
  stage: RunStage;
  status: RunRecord["status"];
  // The stage that ran in this call, or null when nothing ran.
  ran: RunnableStage | null;
  // Why nothing ran.
  reason?: "missing" | "done" | "error" | "busy";
  error?: string | null;
};

export type RunnerDeps = {
  repo: RunRepo;
  stages: Record<RunnableStage, StageFn>;
  // A stage still marked running after this long is assumed dead and can be run again.
  staleAfterMs?: number;
};

export function nextStage(stage: RunnableStage): RunStage {
  const index = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[index + 1] ?? "done";
}

// Plain words for the person. Raw errors and stack traces never reach the page.
export function describeFailure(stage: RunnableStage, error: unknown): string {
  const reason =
    error instanceof UserFacingError ? error.message : `Something went wrong while ${STAGE_LABEL[stage]}.`;
  const outcome = STAGE_CRITICAL[stage]
    ? "The run stopped here. Everything found so far is kept."
    : "Carrying on without it.";
  return `${reason} ${outcome}`;
}

export function createRunner(deps: RunnerDeps) {
  const { repo, stages } = deps;
  const staleAfterMs = deps.staleAfterMs ?? 90_000;

  function snapshot(run: RunRecord, ran: RunnableStage | null, reason?: AdvanceResult["reason"]): AdvanceResult {
    return { runId: run.id, stage: run.stage, status: run.status, ran, reason, error: run.error };
  }

  async function advanceRun(runId: string): Promise<AdvanceResult> {
    const claimed = await repo.claimStage(runId, staleAfterMs);

    if (!claimed) {
      const current = await repo.getRun(runId);
      if (!current) {
        return { runId, stage: "locate", status: "error", ran: null, reason: "missing", error: "Run not found." };
      }
      const reason = current.status === "done" ? "done" : current.status === "error" ? "error" : "busy";
      return snapshot(current, null, reason);
    }

    const stage = claimed.stage;
    if (stage === "done") {
      // A claimed run is never at "done", but a bad row should not loop forever.
      await repo.completeStage(runId, "done");
      return snapshot((await repo.getRun(runId)) ?? claimed, null, "done");
    }

    const tracer = createTracer(repo, runId, stage);
    try {
      await stages[stage]({ run: claimed, trace: tracer });
      await repo.completeStage(runId, nextStage(stage));
    } catch (error) {
      const message = describeFailure(stage, error);
      await tracer.error(message, { detail: error instanceof Error ? error.message.slice(0, 300) : String(error) });
      if (STAGE_CRITICAL[stage]) await repo.failRun(runId, message);
      else await repo.completeStage(runId, nextStage(stage));
    }

    return snapshot((await repo.getRun(runId)) ?? claimed, stage);
  }

  return { advanceRun };
}
