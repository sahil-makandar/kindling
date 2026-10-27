import { getDb } from "@/src/db/client";
import { searchQuerySchema, type FavouriteDomain, FAVOURITE_DOMAINS } from "@/src/checkin/schema";
import { clientIp, handleRoute, HttpError, json } from "@/src/runs/http";
import { checkRateLimit, createDbRateStore } from "@/src/runs/rateLimit";
import { flushAllWrites } from "@/src/lib/batcher";
import { qloo } from "@/src/qloo/endpoints";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// Venues share one wifi network, so the allowance is generous. Repeat searches are answered from the Qloo cache.
const SEARCHES_PER_HOUR = 400;

// Autocomplete for the check-in page: films, music, shows, books and podcasts by name. Only the query text goes to Qloo.
export function GET(request: Request) {
  return handleRoute(async () => {
    const query = searchQuerySchema.parse(new URL(request.url).searchParams.get("q") ?? "");
    const limit = await checkRateLimit(createDbRateStore(getDb()), `search:${clientIp(request.headers)}`, SEARCHES_PER_HOUR);
    if (!limit.allowed) throw new HttpError(429, "That is a lot of searching. Try again in a few minutes.", { retryAfterSeconds: limit.retryAfterSeconds });

    const found = await qloo.searchEntities({ query, types: [...FAVOURITE_DOMAINS], take: 8 }, { purpose: "checkin.search" });
    await flushAllWrites();

    const results = found.items.flatMap((entity) => {
      const domain = /urn:entity:(\w+)/.exec(entity.subtype ?? "")?.[1] as FavouriteDomain | undefined;
      if (!domain || !FAVOURITE_DOMAINS.includes(domain)) return [];
      const year = entity.properties["release_year"] ?? entity.properties["publication_year"];
      return [{ id: entity.id, name: entity.name, domain, hint: typeof year === "number" || typeof year === "string" ? String(year) : null }];
    });
    return json({ results });
  });
}
