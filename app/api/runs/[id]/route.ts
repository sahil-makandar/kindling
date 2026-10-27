import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";
import { getRunState } from "@/src/runs/state";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The run as the page sees it: status, venue, counters, and the trace lines after ?after=<cursor>.
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id);
    const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
    const state = await getRunState(getDb(), id, Number.isFinite(after) && after > 0 ? after : 0);
    if (!state) throw new HttpError(404, "We could not find that run.");
    return json(state);
  });
}
