import type { Db } from "@/src/db/client";
import { and, eq, inArray } from "drizzle-orm";
import { candidates, clubs, signals, venues } from "@/src/db/schema";
import type { ClubKit } from "@/src/agent/producer/kit";
import type { PoolRef } from "@/src/agent/designer/candidates";
import type { VenueView } from "@/src/runs/state";
import { listSessions, type SessionRow } from "./sessions";

export type SessionView = Pick<SessionRow, "id" | "number" | "date" | "checkInCode" | "status" | "simulated">;

export type ClubView = {
  id: string;
  title: string;
  status: "active" | "paused";
  runId: string | null;
  venue: VenueView;
  kit: ClubKit | null;
  anchor: PoolRef | null;
  companions: PoolRef[];
  sessions: SessionView[];
  // How strongly the area favours each thing the club is built from and each playlist artist (Qloo affinity, when known).
  affinities: Record<string, number>;
  qlooMode: "fixtures" | "live" | "record" | null;
};

export const toSessionView = (s: SessionRow): SessionView => ({ id: s.id, number: s.number, date: s.date, checkInCode: s.checkInCode, status: s.status, simulated: s.simulated });

export async function getClub(db: Db, clubId: string): Promise<ClubView | null> {
  const [row] = await db
    .select({ club: clubs, venue: venues, candidate: candidates })
    .from(clubs)
    .innerJoin(venues, eq(venues.id, clubs.venueId))
    .leftJoin(candidates, eq(candidates.id, clubs.candidateId))
    .where(eq(clubs.id, clubId));
  if (!row) return null;

  const { club, venue, candidate } = row;
  const qlooMode = club.runId ? (await db.query.runs.findFirst({ where: (r, { eq: same }) => same(r.id, club.runId as string), columns: { qlooMode: true } }))?.qlooMode ?? null : null;
  return {
    id: club.id,
    title: club.title,
    status: club.status,
    runId: club.runId,
    venue: {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      matchedAddress: venue.matchedAddress,
      lat: venue.lat,
      lon: venue.lon,
      venueType: venue.venueType,
      slowNight: venue.slowNight,
      qlooEntityName: venue.qlooEntityName,
      isDemo: venue.isDemo,
    },
    kit: (club.kit as ClubKit | null) ?? null,
    anchor: (candidate?.anchor as PoolRef | undefined) ?? null,
    companions: (candidate?.companions as PoolRef[] | undefined) ?? [],
    sessions: (await listSessions(db, clubId)).map(toSessionView),
    affinities: await affinitiesFor(db, club.runId, [...(candidate ? [(candidate.anchor as PoolRef).id, ...(candidate.companions as PoolRef[]).map((c) => c.id)] : []), ...((club.kit as ClubKit | null)?.playlist.map((p) => p.refId) ?? [])]),
    qlooMode,
  };
}

async function affinitiesFor(db: Db, runId: string | null, refIds: string[]): Promise<Record<string, number>> {
  if (!runId || refIds.length === 0) return {};
  const rows = await db.select({ refId: signals.refId, affinity: signals.affinity }).from(signals).where(and(eq(signals.runId, runId), inArray(signals.refId, refIds)));
  const out: Record<string, number> = {};
  for (const row of rows) if (row.affinity !== null) out[row.refId] = row.affinity;
  return out;
}
