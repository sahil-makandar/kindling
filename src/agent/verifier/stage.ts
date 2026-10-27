import { UserFacingError } from "@/src/lib/errors";
import type { Endpoints } from "@/src/qloo/endpoints";
import { QlooError } from "@/src/qloo/errors";
import { areaHeat } from "@/src/qloo/tags";
import {
  AREA_SCAN_SIZE,
  coherenceComponent,
  formatFitComponent,
  cityCultureComponent,
  momentumComponent,
  percentileRank,
  rankScored,
  scoreClub,
  sweetSpotComponent,
  type Breakdown,
  type CompanionEvidence,
  type Component,
} from "@/src/scoring/clubScore";
import { isSameKind, nearbyPlacesComponent, venueCrowdComponent, type TagUnit } from "@/src/scoring/localSignals";
import { traceEmptyResult } from "../qlooTrace";
import type { VenueInput } from "../locator";
import type { StageFn } from "../runStage";
import { DOMAIN_LABEL, TRENDING_DOMAINS, type ScoutDomain } from "../scout/plan";
import type { PoolSignal } from "../scout/pool";
import { FORMAT_LABEL, type ClubFormat, type PoolRef } from "../designer/candidates";

// The Verifier: scores every candidate club with the transparent formula in src/scoring/clubScore.ts. For the top
// few (pre-ranked by how strongly the area loves the anchor) it asks Qloo how well the companions go with the anchor,
// using filter.results.entities with the anchor as the taste signal. Missing answers count as low, not as errors.

export const MAX_VERIFIED = 4;
// The heatmap covers a wider area than the scan so the map layer has something to show.
const HEAT_RADIUS_M = 8000;
const HEAT_POINTS_KEPT = 60;

const MEDIA_DOMAINS = new Set<string>(["artist", "movie", "tv_show", "book", "podcast"]);

export type StoredCandidate = {
  id: string;
  title: string;
  anchor: PoolRef;
  companions: PoolRef[];
  format: ClubFormat;
  why: string;
};

export type ScoredRow = {
  id: string;
  score: number;
  breakdown: ScoredBreakdown;
  rank: number;
  verified: boolean;
};

// What is stored in candidates.breakdown: the seven components, and for the best club the heat layer.
export type ScoredBreakdown = Breakdown & {
  heat?: { source: "qloo_heatmap" | "nearby_places"; points: Array<{ lat: number; lon: number; affinity?: number }>; callId: string | null };
};

export type VerifierDeps = {
  getVenue(venueId: string): Promise<VenueInput | null>;
  loadPool(runId: string): Promise<PoolSignal[]>;
  loadCandidates(runId: string): Promise<StoredCandidate[]>;
  saveScores(runId: string, rows: ScoredRow[]): Promise<void>;
  api: Pick<Endpoints, "scoreList" | "insightsHeatmap">;
  maxVerified?: number;
};

type Context = {
  byId: Map<string, PoolSignal>;
  ranges: Map<string, { min: number; max: number }>;
  popularities: number[];
  venueType: string;
  venueName: string;
  // What the places within 1 km and the venue's own crowd carry, as tag names (see src/scoring/localSignals.ts).
  places: TagUnit[];
  crowd: TagUnit[];
  standIn: TagUnit[];
  placeCallIds: string[];
  crowdCallIds: string[];
};

// Min and max affinity of what the area loves in each domain, and of each tag type, for rescaling.
function buildContext(pool: PoolSignal[], venueType: string, venueName: string): Context {
  const ranges = new Map<string, { min: number; max: number }>();
  const widen = (key: string, affinity: number | undefined) => {
    if (affinity === undefined) return;
    const current = ranges.get(key);
    ranges.set(key, { min: Math.min(current?.min ?? affinity, affinity), max: Math.max(current?.max ?? affinity, affinity) });
  };
  for (const s of pool) {
    if (s.kind === "entity" && s.appearances.area) widen(s.domain ?? "", s.appearances.area.affinity);
    if (s.kind === "tag") widen(`tag:${s.tagType ?? ""}`, s.affinity);
  }
  const tagNames = (s: PoolSignal) => s.tags.map((t) => t.name);
  const places = pool.filter((s) => s.kind === "entity" && s.domain === "place" && s.appearances.places).map((s): TagUnit => ({ label: s.name, tags: tagNames(s) }));
  const similar = pool.filter((s) => s.kind === "entity" && s.domain === "place" && s.appearances.venue);
  const ownTags = pool.filter((s) => s.kind === "tag" && s.appearances.venue).map((s) => s.name);
  const crowd: TagUnit[] = [...(ownTags.length > 0 ? [{ label: venueName, tags: ownTags }] : []), ...similar.map((s): TagUnit => ({ label: s.name, tags: tagNames(s) }))];
  const idsOf = (source: "places" | "venue") => [...new Set(pool.map((s) => s.appearances[source]?.callId).filter((id): id is string => !!id))];
  return {
    byId: new Map(pool.map((s) => [s.refId, s])),
    venueName,
    places,
    crowd,
    standIn: places.filter((p) => isSameKind(venueType, p.tags)),
    placeCallIds: idsOf("places"),
    crowdCallIds: idsOf("venue"),
    ranges,
    popularities: pool.filter((s) => s.kind === "entity" && s.domain !== "place" && s.popularity !== undefined).map((s) => s.popularity as number),
    venueType,
  };
}

// The parts of the score that need no new Qloo call: they come from what the Scout already found.
function staticComponents(candidate: StoredCandidate, ctx: Context): Omit<Breakdown, "coherence"> {
  const anchor = ctx.byId.get(candidate.anchor.id);
  const isTag = candidate.anchor.kind === "tag";
  const domainLabel = isTag ? "genres and themes" : DOMAIN_LABEL[candidate.anchor.domain as ScoutDomain] ?? candidate.anchor.domain;

  let local: Component;
  if (isTag) {
    // A tag's place in the tag list stands in for the area scan.
    const sameType = [...ctx.byId.values()].filter((s) => s.kind === "tag" && s.tagType === anchor?.tagType).sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0));
    const rank = anchor ? sameType.findIndex((s) => s.refId === anchor.refId) : -1;
    local = cityCultureComponent({
      anchorName: candidate.anchor.name,
      domainLabel,
      rank: rank >= 0 ? Math.min(rank, AREA_SCAN_SIZE - 1) : null,
      affinity: anchor?.affinity ?? null,
      range: ctx.ranges.get(`tag:${anchor?.tagType ?? ""}`) ?? null,
      callId: anchor?.callId ?? null,
    });
  } else {
    const area = anchor?.appearances.area;
    local = cityCultureComponent({
      anchorName: candidate.anchor.name,
      domainLabel,
      rank: area?.rank ?? null,
      affinity: area?.affinity ?? null,
      range: ctx.ranges.get(candidate.anchor.domain) ?? null,
      callId: area?.callId ?? null,
    });
  }

  // The words that describe the club's taste: the anchor's tags and its companions'.
  const clubTags = [
    ...(isTag ? [candidate.anchor.name] : (anchor?.tags ?? []).map((t) => t.name)),
    ...candidate.companions.flatMap((c) => (c.kind === "tag" ? [c.name] : (ctx.byId.get(c.id)?.tags ?? []).map((t) => t.name))),
  ];
  const placeCompanion = candidate.companions.find((c) => c.domain === "place")?.name ?? null;

  const trend = anchor?.appearances.trend;
  const supportsTrends = isTag || TRENDING_DOMAINS.includes(candidate.anchor.domain as ScoutDomain);
  const popularity = anchor?.popularity ?? null;
  return {
    cityCulture: local,
    venueCrowd: venueCrowdComponent({ venueName: ctx.venueName, clubTags, crowd: ctx.crowd, standIn: ctx.standIn, callIds: ctx.crowdCallIds }),
    nearbyPlaces: nearbyPlacesComponent({ clubName: candidate.title, clubTags, places: ctx.places, placeCompanion, callIds: ctx.placeCallIds }),
    momentum: momentumComponent({ anchorName: candidate.anchor.name, trendRank: trend?.rank ?? null, supported: supportsTrends, callId: trend?.callId ?? null }),
    sweetSpot: sweetSpotComponent({
      anchorName: candidate.anchor.name,
      popularity,
      percentile: popularity === null ? null : percentileRank(popularity, ctx.popularities),
    }),
    formatFit: formatFitComponent({ venueType: ctx.venueType, format: candidate.format, formatLabel: FORMAT_LABEL[candidate.format] }),
  };
}

export function createVerifyStage(deps: VerifierDeps): StageFn {
  return async ({ run, trace }) => {
    const venue = await deps.getVenue(run.venueId);
    if (!venue) throw new Error(`Venue ${run.venueId} not found`);
    const [pool, candidates] = await Promise.all([deps.loadPool(run.id), deps.loadCandidates(run.id)]);
    if (candidates.length === 0) throw new UserFacingError("There are no club ideas to check yet.");

    const ctx = buildContext(pool, venue.venueType, venue.name);
    const parts = new Map(candidates.map((c) => [c.id, staticComponents(c, ctx)]));

    // Pre-rank by how strongly the area loves the anchor, and spend the Qloo calls on the best few.
    const preRanked = rankScored(candidates.map((c) => ({ c, score: parts.get(c.id)!.cityCulture.value, title: c.title })));
    const toVerify = new Set(preRanked.slice(0, deps.maxVerified ?? MAX_VERIFIED).map((x) => x.c.id));
    await trace.info(
      `Checking ${toVerify.size} of the ${candidates.length} clubs with Qloo: do the companions really go with the anchor? The rest are scored from what the Scout already found.`,
    );

    // The checks are independent, so they run together. The client still spaces the requests to Qloo.
    const coherence = new Map<string, Component>();
    await Promise.all(
      candidates.map(async (candidate) => {
        const result = toVerify.has(candidate.id) ? await checkCoherence(candidate, ctx, deps, trace, run.id) : null;
        coherence.set(
          candidate.id,
          result ?? coherenceComponent({ anchorName: candidate.anchor.name, companions: evidenceWithoutQloo(candidate, ctx), callIds: [], verified: false }),
        );
      }),
    );

    const scored = candidates.map((candidate) => {
      const breakdown: ScoredBreakdown = { ...parts.get(candidate.id)!, coherence: coherence.get(candidate.id)! };
      const { score } = scoreClub(breakdown);
      return { id: candidate.id, title: candidate.title, anchor: candidate.anchor, score, breakdown, verified: toVerify.has(candidate.id) && !breakdown.coherence.flagged };
    });
    const ranked = rankScored(scored);

    // The map layer for the best club: where in the wider area people share this taste.
    const best = ranked[0];
    if (best && best.anchor.kind === "entity" && MEDIA_DOMAINS.has(best.anchor.domain)) {
      const places = pool.filter((s) => s.kind === "entity" && s.domain === "place").map(toPlaceEntity);
      const heat = await areaHeat(
        deps.api,
        { anchorId: best.anchor.id, area: { lon: venue.lon, lat: venue.lat, radiusM: HEAT_RADIUS_M }, nearbyPlaces: places },
        { purpose: "verify.heatmap", runId: run.id },
      ).catch(async (error) => {
        if (!(error instanceof QlooError)) throw error;
        await trace.warn(`Could not read where ${best.anchor.name} fans are: ${error.message}`);
        return null;
      });
      if (heat) {
        best.breakdown.heat = {
          source: heat.source,
          points: [...heat.points].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)).slice(0, HEAT_POINTS_KEPT).map((p) => ({ lat: p.lat, lon: p.lon, affinity: p.affinity })),
          callId: heat.callId,
        };
        await trace.info(
          heat.source === "qloo_heatmap"
            ? `Mapped where fans of ${best.anchor.name} live around you.`
            : `${heat.fallbackReason ?? "Qloo has no heatmap for this."}`,
        );
      }
    }

    await deps.saveScores(
      run.id,
      ranked.map((r, index) => ({ id: r.id, score: r.score, breakdown: r.breakdown, rank: index + 1, verified: r.verified })),
    );
    for (const [index, r] of ranked.slice(0, 3).entries()) {
      await trace.info(`Number ${index + 1}: ${r.title}, score ${r.score}${r.verified ? "" : " (not checked with Qloo)"}.`, { score: r.score, id: r.id });
    }
  };
}

function toPlaceEntity(s: PoolSignal) {
  // The heat fallback reads coordinates from a place's location; the pool keeps tags and popularity only, so places
  // without one simply contribute nothing.
  return { id: s.refId, name: s.name, popularity: s.popularity, affinity: s.affinity, tags: s.tags, properties: {} };
}

// Companions Qloo has not been asked about: tags are judged by the anchor's own tags, places are left out.
function evidenceWithoutQloo(candidate: StoredCandidate, ctx: Context): CompanionEvidence[] {
  const anchorTags = new Set((ctx.byId.get(candidate.anchor.id)?.tags ?? []).map((t) => t.name.toLowerCase()));
  return candidate.companions.map((c): CompanionEvidence => {
    if (c.kind === "tag") return { kind: "tag", name: c.name, carriedByAnchor: anchorTags.has(c.name.toLowerCase()) };
    if (c.domain === "place") return { kind: "place", name: c.name };
    return { kind: "scored", name: c.name, affinity: null };
  });
}

// Asks Qloo how fans of the anchor rank each companion. One call per companion domain. Returns null if Qloo could not
// be asked, so the club falls back to the default instead of being punished for our failure.
async function checkCoherence(
  candidate: StoredCandidate,
  ctx: Context,
  deps: VerifierDeps,
  trace: Parameters<StageFn>[0]["trace"],
  runId: string,
): Promise<Component | null> {
  const base = evidenceWithoutQloo(candidate, ctx);
  const scorable = candidate.companions.filter((c) => c.kind === "entity" && MEDIA_DOMAINS.has(c.domain));
  const anchorIsMedia = candidate.anchor.kind === "entity" && MEDIA_DOMAINS.has(candidate.anchor.domain);

  if (scorable.length === 0 || !anchorIsMedia) {
    return coherenceComponent({ anchorName: candidate.anchor.name, companions: base, callIds: [], verified: true });
  }

  const byDomain = new Map<string, PoolRef[]>();
  for (const c of scorable) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c]);

  const affinities = new Map<string, number>();
  const callIds: string[] = [];
  for (const [domain, group] of byDomain) {
    try {
      const result = await deps.api.scoreList(
        { domain: domain as "artist" | "movie" | "tv_show" | "book" | "podcast", entityIds: group.map((g) => g.id), signalEntities: [candidate.anchor.id] },
        { purpose: "verify.coherence", runId },
      );
      if (result.callId) callIds.push(result.callId);
      if (result.empty) await traceEmptyResult(trace, `how fans of ${candidate.anchor.name} rate ${group.map((g) => g.name).join(" and ")}`, result);
      for (const item of result.items) if (item.affinity !== undefined) affinities.set(item.id, item.affinity);
    } catch (error) {
      if (!(error instanceof QlooError)) throw error;
      await trace.warn(`Could not check ${candidate.title} with Qloo: ${error.message}`);
      return null;
    }
  }

  const evidence = base.map((e, index): CompanionEvidence => {
    const companion = candidate.companions[index];
    return e.kind === "scored" ? { kind: "scored", name: e.name, affinity: affinities.get(companion.id) ?? null } : e;
  });
  const ranked = evidence.filter((e) => e.kind === "scored" && e.affinity !== null).length;
  const total = evidence.filter((e) => e.kind === "scored").length;
  await trace.info(
    `Checking whether fans of ${candidate.anchor.name} also love ${scorable.map((s) => s.name).join(" and ")}... Qloo ranked ${ranked} of ${total}.`,
    { callIds },
  );
  return coherenceComponent({ anchorName: candidate.anchor.name, companions: evidence, callIds, verified: true });
}
