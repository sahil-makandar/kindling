import { advanceRun } from "@/src/agent/stages";
import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";
import { getRunState } from "@/src/runs/state";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Runs the run's next stage (one stage per request) and returns where it got to, plus the trace lines since ?after=.
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id);
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0);

    const result = await advanceRun(id);
    if (result.reason === "missing") throw new HttpError(404, "We could not find that run.");

    const state = await getRunState(getDb(), id, Number.isFinite(after) && after > 0 ? after : 0);
    return json({
      stage: result.stage,
      status: result.status,
      ran: result.ran,
      reason: result.reason ?? null,
      error: result.error ?? null,
      state,
    });
  });
}
