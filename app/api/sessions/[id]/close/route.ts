import { closeSession } from "@/src/checkin/repo";
import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// "Close tonight's session": stops check-in and saves the host's headcount and vibe rating.
export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "session");
    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, "Send the headcount and vibe as JSON.");
    });
    return json(await closeSession(getDb(), id, body));
  });
}
