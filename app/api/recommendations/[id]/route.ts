import { respondToRecommendation } from "@/src/coach/repo";
import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// The owner's answer to the Coach: accept, edit (with a changed proposal) or reject.
export function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "recommendation");
    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, "Send your answer as JSON.");
    });
    return json(await respondToRecommendation(getDb(), id, body));
  });
}
