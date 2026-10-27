import { produceKit } from "@/src/agent/producer/repo";
import { getDb } from "@/src/db/client";
import { listSessions, openNextSession } from "@/src/clubs/sessions";
import { toSessionView } from "@/src/clubs/state";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Writes the club's kit (once) and opens its first session so the poster has a check-in code to print.
export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "club");
    const db = getDb();
    const result = await produceKit(id);
    if (!result) throw new HttpError(404, "We could not find that club.");

    const existing = await listSessions(db, id);
    const session = existing[0] ?? (await openNextSession(db, id));
    return json({ kit: result.kit, created: result.created, notes: result.notes, session: toSessionView(session) });
  });
}
