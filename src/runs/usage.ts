import { sql } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { qlooCalls } from "@/src/db/schema";

// What the app asks Qloo, and why, for the How it works page. The wording is ours; the numbers come from the call log,
// so the table shows what the app really did and says "not called yet" for anything it has not done.

export type QlooUse = { purpose: string; endpoint: string; filter: string; stage: string; why: string };

export const QLOO_USES: readonly QlooUse[] = [
  { purpose: "locate.venue", endpoint: "/search", filter: "place", stage: "Locate", why: "Finds your venue on Qloo, so its own tags and crowd are known." },
  { purpose: "scout.area_entities", endpoint: "/v2/insights", filter: "film, music, TV, books, podcasts near the venue", stage: "Scout", why: "What people around the address love in each domain. Run twice per domain: the biggest names and the more local ones." },
  { purpose: "scout.area_tags", endpoint: "/v2/insights", filter: "tags near the venue", stage: "Scout", why: "The vibe of the area's places, used as the language of the neighbourhood." },
  { purpose: "scout.similar_venues", endpoint: "/v2/insights", filter: "places like yours", stage: "Scout", why: "Venues like yours nearby. Their tags describe the kind of crowd your venue draws." },
  { purpose: "scout.trending", endpoint: "/v2/insights", filter: "trending entities near the venue", stage: "Scout", why: "What is rising in the area right now, which feeds the momentum part of the score." },
  { purpose: "scout.places", endpoint: "/v2/insights", filter: "places near the venue", stage: "Scout", why: "Nearby places that match the area's taste, to pair a club with a menu or a neighbour." },
  { purpose: "verify.coherence", endpoint: "/v2/insights", filter: "score list", stage: "Verify", why: "Checks that the anchor and its companions really belong together, with a separate call per club." },
  { purpose: "verify.heatmap", endpoint: "/v2/insights", filter: "heatmap", stage: "Verify", why: "Where on the map the winning club's taste is strongest, for the heat layer." },
  { purpose: "checkin.search", endpoint: "/search", filter: "music, film, shows, books, podcasts", stage: "Check-in", why: "Autocomplete for the three favourites a guest picks." },
  { purpose: "checkin.tags", endpoint: "/entities", filter: "by id", stage: "Check-in", why: "Reads the tags of a guest's favourites. That becomes their taste vector for seating." },
  { purpose: "coach.room_tags", endpoint: "/entities", filter: "by id", stage: "Coach", why: "Reads the tags of the club's own theme, to measure how far the room has drifted from it." },
  { purpose: "coach.adjacent", endpoint: "/v2/insights", filter: "entities near the venue", stage: "Coach", why: "Themes that sit next to what the room loves, for next week's fresh sub-theme." },
];

export type UsageRow = QlooUse & { calls: number; avgMs: number | null };

export async function getQlooUsage(db: Db): Promise<UsageRow[]> {
  const rows = await db
    .select({ purpose: qlooCalls.purpose, calls: sql<number>`count(*)::int`, avgMs: sql<number>`round(avg(${qlooCalls.ms}))::int` })
    .from(qlooCalls)
    .groupBy(qlooCalls.purpose);
  const byPurpose = new Map(rows.map((r) => [r.purpose, r]));
  return QLOO_USES.map((use) => ({ ...use, calls: byPurpose.get(use.purpose)?.calls ?? 0, avgMs: byPurpose.get(use.purpose)?.avgMs ?? null }));
}
