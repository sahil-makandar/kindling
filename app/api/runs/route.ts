import { getDb } from "@/src/db/client";
import { getEnv } from "@/src/config/env";
import { geocode } from "@/src/geo/geocode";
import { createDbRunWriter, createRun } from "@/src/runs/createRun";
import { clientIp, handleRoute, HttpError, json } from "@/src/runs/http";
import { checkRateLimit, createDbRateStore } from "@/src/runs/rateLimit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Starts a run: checks the caller's hourly allowance, finds the address, saves the venue and the run.
// Nothing is scouted here; the page then calls /advance once per stage.
export function POST(request: Request) {
  return handleRoute(async () => {
    const env = getEnv();
    const db = getDb();
    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, "Send the venue details as JSON.");
    });

    const limit = await checkRateLimit(createDbRateStore(db), `run:${clientIp(request.headers)}`, env.RATE_LIMIT_PER_HOUR);
    if (!limit.allowed) {
      const minutes = Math.ceil(limit.retryAfterSeconds / 60);
      throw new HttpError(429, `You have started ${limit.limit} runs this hour, which is the limit for the free demo. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const created = await createRun(body, { geocode, save: createDbRunWriter(db), qlooMode: env.QLOO_MODE });
    return json(
      {
        runId: created.runId,
        location: { lat: created.location.lat, lon: created.location.lon, displayName: created.location.displayName, source: created.location.source },
      },
      201,
    );
  });
}
