import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";
import { getCandidates } from "@/src/runs/state";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The ranked club picks with the Qloo calls behind each score, the heat layer and the "Without Qloo" comparison.
export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id);
    const view = await getCandidates(getDb(), id);
    if (!view) throw new HttpError(404, "We could not find that run.");
    return json(view);
  });
}
