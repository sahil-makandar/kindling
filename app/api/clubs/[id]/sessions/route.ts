import { getDb } from "@/src/db/client";
import { listSessions, openNextSession } from "@/src/clubs/sessions";
import { toSessionView } from "@/src/clubs/state";
import { handleRoute, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "club");
    return json({ sessions: (await listSessions(getDb(), id)).map(toSessionView) });
  });
}

// Opens next week's session with a fresh check-in code.
export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "club");
    return json({ session: toSessionView(await openNextSession(getDb(), id)) }, 201);
  });
}
