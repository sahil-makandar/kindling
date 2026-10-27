import { loadBoard } from "@/src/checkin/repo";
import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Who is here and where they sit, for the host's live view.
export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "session");
    const board = await loadBoard(getDb(), id);
    if (!board) throw new HttpError(404, "We could not find that session.");
    return json(board);
  });
}
