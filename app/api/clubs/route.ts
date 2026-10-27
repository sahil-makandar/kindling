import { getDb } from "@/src/db/client";
import { createClub, createDbClubRepo } from "@/src/clubs/createClub";
import { handleRoute, HttpError, json } from "@/src/runs/http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// "Make this our club": saves the chosen pick as the venue's club. The kit itself is written when its page opens.
export function POST(request: Request) {
  return handleRoute(async () => {
    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, "Send the chosen club as JSON.");
    });
    const result = await createClub(body, createDbClubRepo(getDb()));
    return json(result, result.created ? 201 : 200);
  });
}
