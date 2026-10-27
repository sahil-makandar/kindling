import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { PoolRef } from "@/src/agent/designer/candidates";
import { generateStructured } from "@/src/agent/llm";
import { getDb, type Db } from "@/src/db/client";
import { candidates, checkins, clubs, recommendations, sessions, venues } from "@/src/db/schema";
import { flushAllWrites } from "@/src/lib/batcher";
import { qloo } from "@/src/qloo/endpoints";
import { tagsForFavourites } from "@/src/qloo/tags";
import { openNextSession } from "@/src/clubs/sessions";
import { HttpError } from "@/src/runs/http";
import { toVector, type Favourite, type TasteVector } from "@/src/seating/tasteVector";
import { createCoach, type CoachClub, type CoachDeps, type Proposal, type Recommendation, type RecommendationSignals } from "./coach";
import { buildWeeks, type RawCheckin, type Weeks } from "./weeks";

export async function loadWeeks(db: Db, clubId: string): Promise<{ weeks: Weeks; baseline: number | null } | null> {
  const [club] = await db
    .select({ baseline: venues.baselineHeadcount })
    .from(clubs)
    .innerJoin(venues, eq(venues.id, clubs.venueId))
    .where(eq(clubs.id, clubId));
  if (!club) return null;

  const rows = await db.select().from(sessions).where(eq(sessions.clubId, clubId));
  const ids = rows.map((s) => s.id);
  const stored = ids.length === 0 ? [] : await db.select().from(checkins).where(inArray(checkins.sessionId, ids));
  const raw: RawCheckin[] = stored.map((c) => ({
    sessionId: c.sessionId,
    attendeeId: c.attendeeId,
    tableNo: c.tableNo,
    consent: c.consentSeating,
    vector: (c.tagVector as TasteVector | null) ?? null,
    favourites: ((c.favourites ?? []) as Favourite[]).map((f) => ({ id: f.id, name: f.name })),
  }));
  const weeks = buildWeeks({
    sessions: rows.map((s) => ({ id: s.id, number: s.number, date: s.date, status: s.status, simulated: s.simulated, headcountManual: s.headcountManual, vibeRating: s.vibeRating })),
    checkins: raw,
    baseline: club.baseline,
  });
  return { weeks, baseline: club.baseline };
}

type StoredSignals = RecommendationSignals & { source?: Recommendation["source"] };

function toRecommendation(row: typeof recommendations.$inferSelect): Recommendation {
  const { source, ...signals } = row.signals as StoredSignals;
  return {
    id: row.id,
    clubId: row.clubId,
    afterSessionId: row.afterSessionId,
    decision: row.decision,
    signals,
    proposal: row.proposal as Proposal,
    rationale: row.rationale,
    status: row.status,
    source: source ?? "llm",
  };
}

export async function latestRecommendation(db: Db, clubId: string): Promise<Recommendation | null> {
  const [row] = await db.select().from(recommendations).where(eq(recommendations.clubId, clubId)).orderBy(desc(recommendations.createdAt)).limit(1);
  return row ? toRecommendation(row) : null;
}

const MEDIA = new Set(["artist", "movie", "tv_show", "book", "podcast"]);

async function loadCoachClub(db: Db, clubId: string): Promise<CoachClub | null> {
  const [row] = await db
    .select({ club: clubs, venue: venues, candidate: candidates })
    .from(clubs)
    .innerJoin(venues, eq(venues.id, clubs.venueId))
    .leftJoin(candidates, eq(candidates.id, clubs.candidateId))
    .where(eq(clubs.id, clubId));
  if (!row || !row.club.runId) return null;
  const data = await loadWeeks(db, clubId);
  if (!data) return null;

  const refs = row.candidate ? [row.candidate.anchor as PoolRef, ...(row.candidate.companions as PoolRef[])] : [];
  const media = refs.filter((r) => r.kind === "entity" && MEDIA.has(r.domain));
  const anchor = refs[0];
  const [second] = await db
    .select({ title: candidates.title })
    .from(candidates)
    .where(eq(candidates.runId, row.club.runId))
    .orderBy(candidates.rank)
    .offset(1)
    .limit(1);

  return {
    clubId,
    runId: row.club.runId,
    title: row.club.title,
    venueType: row.venue.venueType,
    slowNight: row.venue.slowNight,
    baseline: data.baseline,
    weeks: data.weeks,
    themeEntityIds: media.map((r) => r.id),
    themeDomain: anchor && MEDIA.has(anchor.domain) ? (anchor.domain as NonNullable<CoachClub["themeDomain"]>) : (media[0]?.domain as CoachClub["themeDomain"]) ?? null,
    venue: { lat: row.venue.lat, lon: row.venue.lon },
    nextBestTitle: second?.title ?? null,
    existing: await latestRecommendation(db, clubId),
  };
}

export function createDbCoachDeps(db: Db): CoachDeps {
  return {
    load: (clubId) => loadCoachClub(db, clubId),

    async clubTaste(ids) {
      const result = await tagsForFavourites(qloo, { favouriteIds: [...ids].sort() }, { purpose: "coach.room_tags" });
      return toVector(result.tags);
    },

    async adjacentThemes({ domain, seedIds, venue }) {
      const found = await qloo.insightsEntities(
        { domain, signalEntities: seedIds, signalArea: { lat: venue.lat, lon: venue.lon, radiusM: 2000 }, excludeEntities: seedIds, take: 8 },
        { purpose: "coach.adjacent" },
      );
      return found.items.map((e) => e.name);
    },

    async save(rec) {
      const [row] = await db
        .insert(recommendations)
        .values({
          clubId: rec.clubId,
          afterSessionId: rec.afterSessionId,
          decision: rec.decision,
          signals: { ...rec.signals, source: rec.source },
          proposal: rec.proposal,
          rationale: rec.rationale,
          status: rec.status,
        })
        .returning();
      return toRecommendation(row);
    },

    generateStructured,
  };
}

// The Coach wired to the database, Qloo and the language model. Built on first use.
export async function recommendFor(clubId: string, options: { force?: boolean } = {}) {
  const result = await createCoach(createDbCoachDeps(getDb()))(clubId, options);
  await flushAllWrites();
  return result;
}

// ---- the owner's answer ----

export const respondSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("reject") }),
  z.object({
    action: z.literal("edit"),
    proposal: z.object({
      variantTitle: z.string().trim().min(2, "Give the night a title.").max(80),
      hook: z.string().trim().min(2, "Write a one-line hook.").max(110, "Keep the hook to 110 characters."),
      runOfShowChange: z.string().trim().min(2, "Say what changes in the running order.").max(500),
    }),
  }),
]);

// Accept or edit puts the variant on the next session (opening one if there is none waiting). Reject changes nothing else.
export async function respondToRecommendation(db: Db, id: string, raw: unknown): Promise<{ recommendation: Recommendation; sessionNumber: number | null }> {
  const input = respondSchema.parse(raw);
  const [row] = await db.select().from(recommendations).where(eq(recommendations.id, id));
  if (!row) throw new HttpError(404, "We could not find that recommendation.");

  if (input.action === "reject") {
    const [updated] = await db.update(recommendations).set({ status: "rejected" }).where(eq(recommendations.id, id)).returning();
    return { recommendation: toRecommendation(updated), sessionNumber: null };
  }

  const proposal = input.action === "edit" ? input.proposal : (row.proposal as Proposal);
  const club = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.id, row.clubId));
  if (club.length === 0) throw new HttpError(404, "We could not find that club.");

  const upcoming = await db.select().from(sessions).where(eq(sessions.clubId, row.clubId)).orderBy(desc(sessions.number));
  const withCheckins = new Set((await db.select({ sessionId: checkins.sessionId }).from(checkins).where(inArray(checkins.sessionId, upcoming.map((s) => s.id).concat("00000000-0000-0000-0000-000000000000")))).map((c) => c.sessionId));
  const waiting = upcoming.find((s) => s.status === "open" && !withCheckins.has(s.id));
  const next = waiting ?? (await openNextSession(db, row.clubId));
  await db.update(sessions).set({ variant: proposal }).where(eq(sessions.id, next.id));

  const [updated] = await db
    .update(recommendations)
    .set({ status: input.action === "edit" ? "edited" : "accepted", proposal })
    .where(eq(recommendations.id, id))
    .returning();
  return { recommendation: toRecommendation(updated), sessionNumber: next.number };
}
