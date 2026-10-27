import { recommendFor } from "@/src/coach/repo";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The Coach reads the latest night and writes next week's recommendation. Asking twice for the same night returns the
// first answer; ?force=1 asks again.
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "club");
    const force = new URL(request.url).searchParams.get("force") === "1";
    const result = await recommendFor(id, { force });
    if (!result) throw new HttpError(409, "The Coach needs at least one night with check-ins before it can recommend anything.");
    return json({ recommendation: result.recommendation, created: result.created }, result.created ? 201 : 200);
  });
}
