import { desc, eq } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { clubs, runs, sessions, venues } from "@/src/db/schema";

// Where a venue is on its journey, for the stepper. Cheap lookups only, one run or one club in, a few flags out.

export const STEPS = [
  { key: "read", label: "Read the neighbourhood", short: "Read" },
  { key: "pick", label: "Pick your club", short: "Pick" },
  { key: "kit", label: "Get your kit", short: "Kit" },
  { key: "night", label: "Run the night", short: "Night" },
  { key: "grow", label: "See it grow", short: "Grow" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export type Journey = {
  venueName: string;
  venueType: string;
  slowNight: string;
  isDemo: boolean;
  runId: string | null;
  runDone: boolean;
  clubId: string | null;
  clubTitle: string | null;
  kitReady: boolean;
  checkIns: boolean;
};

export type JourneyLink = { key: StepKey; label: string; short: string; href: string | null; state: "done" | "current" | "todo" };

export async function getJourney(db: Db, ref: { runId?: string; clubId?: string }): Promise<Journey | null> {
  let runId = ref.runId ?? null;
  let clubId = ref.clubId ?? null;

  if (clubId) {
    const [club] = await db.select({ runId: clubs.runId }).from(clubs).where(eq(clubs.id, clubId));
    if (!club) return null;
    runId = club.runId;
  }

  const run = runId ? (await db.select({ status: runs.status, venueId: runs.venueId }).from(runs).where(eq(runs.id, runId)))[0] : undefined;
  if (runId && !run) return null;

  if (!clubId && runId) {
    const [first] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.runId, runId)).orderBy(desc(clubs.createdAt)).limit(1);
    clubId = first?.id ?? null;
  }

  const club = clubId ? (await db.select({ title: clubs.title, kit: clubs.kit, venueId: clubs.venueId }).from(clubs).where(eq(clubs.id, clubId)))[0] : undefined;
  const venueId = run?.venueId ?? club?.venueId;
  if (!venueId) return null;
  const [venue] = await db.select().from(venues).where(eq(venues.id, venueId));
  if (!venue) return null;

  const hasSessions = clubId ? (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.clubId, clubId)).limit(2)).length > 0 : false;
  return {
    venueName: venue.name,
    venueType: venue.venueType,
    slowNight: venue.slowNight,
    isDemo: venue.isDemo,
    runId,
    runDone: run?.status === "done",
    clubId,
    clubTitle: club?.title ?? null,
    kitReady: Boolean(club?.kit),
    checkIns: hasSessions,
  };
}

// Links for each step. A step is clickable once it can be opened. The current step has no link of its own.
export function journeyLinks(j: Journey, current: StepKey): JourneyLink[] {
  const hrefs: Record<StepKey, string | null> = {
    read: j.runId ? `/runs/${j.runId}` : null,
    pick: j.runId && j.runDone ? `/runs/${j.runId}/clubs` : null,
    kit: j.clubId ? `/clubs/${j.clubId}` : null,
    night: j.clubId && j.kitReady ? `/clubs/${j.clubId}/live` : null,
    grow: j.clubId && j.kitReady ? `/clubs/${j.clubId}/weeks` : null,
  };
  const order = STEPS.map((s) => s.key);
  const at = order.indexOf(current);
  return STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    short: s.short,
    href: s.key === current ? null : hrefs[s.key],
    state: s.key === current ? "current" : i < at ? "done" : "todo",
  }));
}
