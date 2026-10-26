import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { SCOUT_DOMAINS } from "./plan";
import type { ScoutRun } from "./scout";

// The seven tools the model can call (PRODUCT_SPEC section 4). They only forward to ScoutRun, which owns the
// budget, the repeat rules and the trace. The model must give a reason for every call, and that reason goes
// into the trace so the page can show why the Scout chose each step.

const reason = z
  .string()
  .min(3)
  .max(300)
  .describe("In plain words: what you are looking for and why this is the best next step given what you found so far.");
const domain = z.enum(SCOUT_DOMAINS).describe("artist is music, movie is film.");

export function buildScoutTools(scout: ScoutRun): ToolSet {
  return {
    scan_area: tool({
      description: "Read what people in the area love in one domain. Costs 1 Qloo call.",
      inputSchema: z.object({ domain, reason }),
      execute: ({ domain, reason }) => scout.serial(() => scout.scanArea(domain, reason)),
    }),
    scan_area_tags: tool({
      description: "Read the area's tag vocabulary: the words that describe its taste. Costs at most 1 Qloo call.",
      inputSchema: z.object({ reason }),
      execute: ({ reason }) => scout.serial(() => scout.scanAreaTags(reason)),
    }),
    scan_venue_crowd: tool({
      description: "Read what the venue's own crowd loves in one domain. Only works if the venue is in Qloo. Costs 1 Qloo call.",
      inputSchema: z.object({ domain, reason }),
      execute: ({ domain, reason }) => scout.serial(() => scout.scanVenueCrowd(domain, reason)),
    }),
    scan_trending: tool({
      description: "Read what is rising in the area in one domain. Costs 1 Qloo call.",
      inputSchema: z.object({ domain, reason }),
      execute: ({ domain, reason }) => scout.serial(() => scout.scanTrending(domain, reason)),
    }),
    scan_nearby_places: tool({
      description: "Look at the food and venue scene near the address. Costs 1 Qloo call.",
      inputSchema: z.object({ reason }),
      execute: ({ reason }) => scout.serial(() => scout.scanNearbyPlaces(reason)),
    }),
    widen_radius: tool({
      description: "Widen the area when a scan came back thin. Free, but you must scan thin domains again afterwards.",
      inputSchema: z.object({ reason }),
      execute: ({ reason }) => scout.serial(() => scout.widenRadius(reason)),
    }),
    finish: tool({
      description: "End scouting. Refused until there are strong signals in at least 4 domains, the area's tags, and a trend or places scan.",
      inputSchema: z.object({ summary: z.string().min(3).max(400).describe("One or two sentences on what the area loves.") }),
      execute: ({ summary }) => scout.serial(() => scout.finish(summary)),
    }),
  };
}
