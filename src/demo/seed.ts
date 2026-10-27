import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { advanceRun } from "@/src/agent/stages";
import { createDbDesignerRepo } from "@/src/agent/designer/repo";
import type { PoolRef } from "@/src/agent/designer/candidates";
import { produceKit } from "@/src/agent/producer/repo";
import type { PoolSignal } from "@/src/agent/scout/pool";
import { createDbCheckInRepo } from "@/src/checkin/repo";
import { createClub, createDbClubRepo } from "@/src/clubs/createClub";
import { generateCheckInCode, nextOccurrence, openNextSession } from "@/src/clubs/sessions";
import { recommendFor } from "@/src/coach/repo";
import { getEnv } from "@/src/config/env";
import { getDb } from "@/src/db/client";
import { attendees, baselines, candidates, clubs, llmOutputs, sessions, venues } from "@/src/db/schema";
import type { QlooEntity } from "@/src/qloo/schemas";
import { tagsFromEntities } from "@/src/qloo/tags";
import { createDbRunWriter, createRun } from "@/src/runs/createRun";
import { toVector } from "@/src/seating/tasteVector";
import { nicknameFor, pickFavouriteIds, planNights } from "./plan";

// Builds the demo venue (N5): a fictional venue, a real agent run, a club from the top pick and four simulated past
// nights seated by the real seating code. Every simulated row is marked simulated = true, and the pages say so.
// The language model must really answer for the design, the comparison, the kit and the Coach, so each of those is
// retried when the free tier is busy, and the script says so plainly if it still could not.

export const DEMO_VENUE_NAME = "The Lantern Room (fictional demo venue)";
const MEDIA = new Set(["artist", "movie", "tv_show", "book", "podcast"]);
const DAY_MS = 86_400_000;
const VIBE = [4, 4, 5, 5];
const ATTEMPTS = 4;
const WAIT_MS = 45_000;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shiftDays = (date: string, days: number) => ymd(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Groups of related media entities, by the first genre or theme tag they carry, so simulated people have clear tastes.
// The club's own theme is listed first, and twice, so about a third of the room came for the theme itself.
export function tasteGroups(pool: readonly PoolSignal[], themeRefs: readonly PoolRef[] = []): string[][] {
  const media = pool.filter((s) => s.kind === "entity" && s.domain && MEDIA.has(s.domain));
  const byTag = new Map<string, string[]>();
  for (const entity of media) {
    const key = entity.tags[0]?.name.trim().toLowerCase();
    if (key) byTag.set(key, [...(byTag.get(key) ?? []), entity.refId]);
  }
  let groups = [...byTag.values()].filter((g) => g.length >= 3).sort((a, b) => b.length - a.length).slice(0, 4);
  if (groups.length < 2) {
    const byDomain = new Map<string, string[]>();
    for (const entity of media) byDomain.set(entity.domain as string, [...(byDomain.get(entity.domain as string) ?? []), entity.refId]);
    groups = [...byDomain.values()].filter((g) => g.length >= 3);
  }

  const theme = new Set(themeRefs.filter((r) => r.kind === "entity" && MEDIA.has(r.domain)).map((r) => r.id));
  const themeTags = new Set(media.filter((s) => theme.has(s.refId)).flatMap((s) => s.tags.slice(0, 3).map((t) => t.name.trim().toLowerCase())));
  const themed = media.filter((s) => theme.has(s.refId) || s.tags.some((t) => themeTags.has(t.name.trim().toLowerCase()))).map((s) => s.refId);
  return themed.length >= 3 ? [themed, themed, ...groups] : groups;
}

export type SeedResult = { clubId: string; runId: string; created: boolean };

type Log = (line: string) => void;

// Runs the step until the language model, not the template, wrote the answer. Gives up quietly after a few tries.
async function untilModel<T extends { source: string }>(label: string, log: Log, step: () => Promise<T | null>): Promise<T | null> {
  let last: T | null = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    last = await step();
    if (!last || last.source !== "fallback") return last;
    if (attempt < ATTEMPTS) {
      log(`  ${label}: the model was busy, trying again in ${WAIT_MS / 1000}s (${attempt}/${ATTEMPTS})`);
      await sleep(WAIT_MS);
    }
  }
  log(`  ${label}: no model answered, so this part uses the plain template.`);
  return last;
}

async function modelAnswered(runId: string): Promise<{ design: boolean; baseline: boolean }> {
  const db = getDb();
  const design = await db.select({ id: llmOutputs.id }).from(llmOutputs).where(and(eq(llmOutputs.runId, runId), eq(llmOutputs.cacheKey, "design")));
  const baseline = await db.select({ id: baselines.id }).from(baselines).where(eq(baselines.runId, runId));
  return { design: design.length > 0, baseline: baseline.length > 0 };
}

async function removeDemo(log: Log) {
  const db = getDb();
  log("Removing the old demo venue and its simulated people...");
  await db.delete(venues).where(eq(venues.isDemo, true));
  await db.delete(attendees).where(eq(attendees.simulated, true));
}

async function createAndRun(log: Log) {
  const db = getDb();
  const env = getEnv();
  log(`Creating the demo venue (Qloo mode: ${env.QLOO_MODE})...`);
  const created = await createRun(
    {
      name: DEMO_VENUE_NAME,
      address: "Bedford Ave, Brooklyn, NY",
      venueType: "bar",
      slowNight: "tuesday",
      baselineHeadcount: 6,
      lat: 40.7081,
      lon: -73.9571,
      matchedAddress: "Bedford Ave, Williamsburg, Brooklyn, NY",
    },
    { geocode: async () => null, save: createDbRunWriter(db), qlooMode: env.QLOO_MODE },
  );
  await db.update(venues).set({ isDemo: true }).where(eq(venues.id, created.venueId));

  log("Running the agent...");
  for (let guard = 0; guard < 12; guard++) {
    const step = await advanceRun(created.runId);
    log(`  ${step.ran ?? "nothing"} -> ${step.stage} (${step.status})`);
    if (step.status === "done") return created;
    if (step.status === "error") throw new Error(`The demo run failed: ${step.error ?? "unknown error"}`);
  }
  throw new Error("The demo run did not finish.");
}

export async function seedDemo(options: { force?: boolean; log?: Log } = {}): Promise<SeedResult> {
  const log = options.log ?? (() => undefined);
  const db = getDb();
  const live = getEnv().LLM_MODE === "live";

  const existing = await db.select({ id: venues.id }).from(venues).where(eq(venues.isDemo, true));
  if (existing.length > 0 && !options.force) {
    const [club] = await db.select({ id: clubs.id, runId: clubs.runId }).from(clubs).innerJoin(venues, eq(venues.id, clubs.venueId)).where(eq(venues.isDemo, true)).orderBy(desc(clubs.createdAt)).limit(1);
    log("The demo venue already exists. Run with --force to rebuild it.");
    return { clubId: club?.id ?? "", runId: club?.runId ?? "", created: false };
  }
  if (existing.length > 0) await removeDemo(log);

  // The Qloo answers are cached, so a second attempt costs almost no Qloo calls. Only a busy model triggers one.
  let created = await createAndRun(log);
  for (let attempt = 1; live && attempt < ATTEMPTS; attempt++) {
    const answered = await modelAnswered(created.runId);
    if (answered.design && answered.baseline) break;
    log(`The model did not answer for ${[!answered.design && "the design", !answered.baseline && "the comparison"].filter(Boolean).join(" and ")}. Trying again in ${WAIT_MS / 1000}s (${attempt}/${ATTEMPTS - 1}).`);
    await sleep(WAIT_MS);
    await removeDemo(log);
    created = await createAndRun(log);
  }

  const [top] = await db
    .select({ id: candidates.id, title: candidates.title, anchor: candidates.anchor, companions: candidates.companions })
    .from(candidates)
    .where(eq(candidates.runId, created.runId))
    .orderBy(sql`${candidates.rank} asc nulls last`, desc(candidates.score));
  if (!top) throw new Error("The demo run produced no club candidates.");
  log(`Top pick: ${top.title}`);

  const { clubId } = await createClub({ candidateId: top.id }, createDbClubRepo(db));
  log("Writing the kit...");
  await untilModel("kit", log, async () => {
    const result = await produceKit(clubId);
    if (result?.kit.source === "fallback") await db.update(clubs).set({ kit: null }).where(eq(clubs.id, clubId));
    return result ? { source: result.kit.source } : null;
  });
  // The last attempt may have been cleared above; make sure the club ends with a kit.
  await produceKit(clubId);

  // ---- four simulated nights, seated for real ----
  const pool = await createDbDesignerRepo(db).loadPool(created.runId);
  const bySignal = new Map(pool.map((s) => [s.refId, s]));
  const groups = tasteGroups(pool, [top.anchor as PoolRef, ...(top.companions as PoolRef[])]);
  if (groups.length === 0) throw new Error("The pool has no media entities to build simulated tastes from.");

  const checkIn = createDbCheckInRepo(db);
  const upcoming = nextOccurrence("tuesday", ymd(Date.now()));
  const nights = planNights();
  const attendeeFor = new Map<string, string>();
  const [clubRow] = await db.select({ title: clubs.title }).from(clubs).where(eq(clubs.id, clubId));
  const clubTitle = clubRow?.title ?? top.title;

  for (let i = 0; i < nights.length; i++) {
    const date = shiftDays(upcoming, -7 * (nights.length - i));
    const [session] = await db
      .insert(sessions)
      .values({ clubId, number: i + 1, date, checkInCode: generateCheckInCode(), status: "closed", simulated: true, vibeRating: VIBE[i] ?? 4 })
      .returning();
    log(`Night ${i + 1} (${date}): ${nights[i].length} check-ins`);

    for (const personId of nights[i]) {
      let attendeeId = attendeeFor.get(personId);
      if (!attendeeId) {
        attendeeId = await checkIn.createAttendee(nicknameFor(personId), null);
        attendeeFor.set(personId, attendeeId);
      }
      const picked = pickFavouriteIds(groups, personId).flatMap((id) => {
        const signal = bySignal.get(id);
        return signal && signal.domain ? [signal] : [];
      });
      const entities: QlooEntity[] = picked.map((s) => ({ id: s.refId, name: s.name, tags: s.tags, properties: {}, popularity: s.popularity, affinity: s.affinity }));
      await checkIn.saveAndSeat({
        session: { id: session.id, clubId, status: "open", date, clubTitle, venueName: DEMO_VENUE_NAME },
        attendeeId,
        nickname: nicknameFor(personId),
        favourites: picked.map((s) => ({ id: s.refId, name: s.name, domain: s.domain as "artist" })),
        vector: toVector(tagsFromEntities(entities, "count")),
        consentSeating: true,
      });
    }
  }
  await db.update(attendees).set({ simulated: true }).where(inArray(attendees.id, [...attendeeFor.values()]));

  const next = await openNextSession(db, clubId);
  log(`Next real session: number ${next.number} on ${next.date}, check-in code ${next.checkInCode}`);

  log("Asking the Coach for next week's recommendation...");
  const coach = await untilModel("coach", log, async () => {
    const result = await recommendFor(clubId, { force: true });
    return result ? { source: result.recommendation.source, decision: result.recommendation.decision } : null;
  });
  log(coach ? `Coach says: ${coach.decision} (${coach.source})` : "The Coach had no nights to read.");

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.clubId, clubId), eq(sessions.simulated, true)));
  log(`Done: ${n} simulated nights.`);
  return { clubId, runId: created.runId, created: true };
}
