import { checkIn } from "@/src/checkin/checkIn";
import { deviceCookie, readDeviceToken } from "@/src/checkin/cookie";
import { createDbCheckInRepo } from "@/src/checkin/repo";
import { tasteFor } from "@/src/checkin/taste";
import { getDb } from "@/src/db/client";
import { flushAllWrites } from "@/src/lib/batcher";
import { clientIp, handleRoute, HttpError, json } from "@/src/runs/http";
import { checkRateLimit, createDbRateStore } from "@/src/runs/rateLimit";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const CHECKINS_PER_HOUR = 300;

// A guest checks in with a name and three favourites and is seated by taste.
export function POST(request: Request) {
  return handleRoute(async () => {
    const db = getDb();
    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, "Send the check-in as JSON.");
    });
    const limit = await checkRateLimit(createDbRateStore(db), `checkin:${clientIp(request.headers)}`, CHECKINS_PER_HOUR);
    if (!limit.allowed) throw new HttpError(429, "Too many check-ins from this network. Ask the host to seat you.", { retryAfterSeconds: limit.retryAfterSeconds });

    const result = await checkIn(body, { repo: createDbCheckInRepo(db), tasteFor, deviceToken: readDeviceToken(request.headers.get("cookie")) });
    await flushAllWrites();

    const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    const { deviceToken, ...visible } = result;
    return json(visible, 200, deviceToken ? { "set-cookie": deviceCookie(deviceToken, secure) } : {});
  });
}
