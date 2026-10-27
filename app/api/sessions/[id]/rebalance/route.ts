import { rebalanceSession } from "@/src/checkin/repo";
import { getDb } from "@/src/db/client";
import { handleRoute, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// The host's "Re-balance tables": seats everyone who asked to be matched again, from scratch.
export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const id = requireUuid((await params).id, "session");
    return json(await rebalanceSession(getDb(), id));
  });
}
