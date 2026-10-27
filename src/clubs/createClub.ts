import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/src/db/client";
import { candidates, clubs, runs } from "@/src/db/schema";
import { HttpError } from "@/src/runs/http";

export const createClubSchema = z.object({ candidateId: z.string().uuid("Pick one of the clubs.") });

export type ClubRepo = {
  // The candidate and where it came from, or null when there is no such candidate.
  loadCandidate(candidateId: string): Promise<{ title: string; runId: string; venueId: string } | null>;
  findByCandidate(candidateId: string): Promise<string | null>;
  insert(row: { venueId: string; runId: string; candidateId: string; title: string }): Promise<string>;
};

// Turns a pick into the venue's club. Choosing the same pick twice gives the same club back.
export async function createClub(raw: unknown, repo: ClubRepo): Promise<{ clubId: string; created: boolean }> {
  const { candidateId } = createClubSchema.parse(raw);
  const candidate = await repo.loadCandidate(candidateId);
  if (!candidate) throw new HttpError(404, "We could not find that club pick. Go back to the picks and choose again.");

  const existing = await repo.findByCandidate(candidateId);
  if (existing) return { clubId: existing, created: false };

  const clubId = await repo.insert({ venueId: candidate.venueId, runId: candidate.runId, candidateId, title: candidate.title });
  return { clubId, created: true };
}

export function createDbClubRepo(db: Db): ClubRepo {
  return {
    async loadCandidate(candidateId) {
      const [row] = await db
        .select({ title: candidates.title, runId: candidates.runId, venueId: runs.venueId })
        .from(candidates)
        .innerJoin(runs, eq(runs.id, candidates.runId))
        .where(eq(candidates.id, candidateId));
      return row ?? null;
    },
    async findByCandidate(candidateId) {
      const [row] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.candidateId, candidateId));
      return row?.id ?? null;
    },
    async insert(row) {
      const [created] = await db.insert(clubs).values(row).returning({ id: clubs.id });
      return created.id;
    },
  };
}
