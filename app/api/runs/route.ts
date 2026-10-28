import { getDb } from "@/src/db/client";
import { getEnv } from "@/src/config/env";
import { geocode } from "@/src/geo/geocode";
import { createDbRunFinder, createDbRunWriter, createRun } from "@/src/runs/createRun";
import { clientIp, handleRoute, HttpError, json } from "@/src/runs/http";
import { checkRateLimit, createDbRateStore } from "@/src/runs/rateLimit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Starts a run: finds the address, reuses a finished run for the same venue if there is one, otherwise checks the
// caller's hourly allowance and saves the venue and the run.
// Nothing is scouted here; the page then calls /advance once per stage.
export function POST(request: Request) {
  return handleRoute(async () => {
    const env = getEnv();
    const db = getDb();
    const body: unknown = await request.json().catch(() => {
      throw new HttpError(400, "Send the venue details as JSON.");
    });

    // A run that is reused costs nothing, so only a new run counts against the hourly allowance.
    const beforeCreate = async () => {
      const limit = await checkRateLimit(createDbRateStore(db), `run:${clientIp(request.headers)}`, env.RATE_LIMIT_PER_HOUR);
      if (!limit.allowed) {
        const minutes = Math.ceil(limit.retryAfterSeconds / 60);
        throw new HttpError(429, `You have read ${limit.limit} neighbourhoods this hour, which is as many as this free site can do for one visitor. You can try again in about ${minutes} minute${minutes === 1 ? "" : "s"}, and the sample venue is open in the meantime.`, {
          retryAfterSeconds: limit.retryAfterSeconds,
        });
      }
    };

    const created = await createRun(body, { geocode, save: createDbRunWriter(db), findCached: createDbRunFinder(db), beforeCreate, qlooMode: env.QLOO_MODE });
    return json(
      {
        runId: created.runId,
        cached: created.cached,
        location: { lat: created.location.lat, lon: created.location.lon, displayName: created.location.displayName, source: created.location.source },
      },
      created.cached ? 200 : 201,
    );
  });
}
