import { randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { clubs, sessions, venues } from "@/src/db/schema";
import { HttpError } from "@/src/runs/http";

// Sessions are the weekly nights. Each has a short check-in code that goes in the poster's QR.

// No 0, O, 1, I, L or U, so a code read aloud or typed from a printed poster cannot be mistaken.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 8;

export function generateCheckInCode(pick: (max: number) => number = (max) => randomInt(max)): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return code;
}

// Check-in codes are matched ignoring case and stray spaces or dashes.
export const normaliseCode = (input: string): string => input.replace(/[\s-]/g, "").toUpperCase();

const NIGHT_INDEX: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DAY_MS = 86_400_000;

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`);

// The first date on or after `from` (YYYY-MM-DD) that falls on the slow night. Dates are calendar dates in UTC;
// a venue's own timezone could shift the day by one, which the host can see on the kit page.
export function nextOccurrence(slowNight: string, from: string): string {
  const target = NIGHT_INDEX[slowNight] ?? 2;
  const start = dayStart(from);
  const current = new Date(start).getUTCDay();
  return ymd(start + ((target - current + 7) % 7) * DAY_MS);
}

export type SessionRow = typeof sessions.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null);
  return code?.code === "23505" || code?.cause?.code === "23505";
}

// Opens the club's next session: one week after the last one, or the next slow night for the first. Retries if the
// random code happens to collide.
export async function openNextSession(db: Db, clubId: string, now: number = Date.now()): Promise<SessionRow> {
  const [club] = await db
    .select({ slowNight: venues.slowNight })
    .from(clubs)
    .innerJoin(venues, eq(venues.id, clubs.venueId))
    .where(eq(clubs.id, clubId));
  if (!club) throw new HttpError(404, "We could not find that club.");

  const today = ymd(now);
  for (let attempt = 0; attempt < 5; attempt++) {
    const [last] = await db.select().from(sessions).where(eq(sessions.clubId, clubId)).orderBy(desc(sessions.number)).limit(1);
    const afterLast = last ? ymd(dayStart(last.date) + DAY_MS) : today;
    const from = afterLast > today ? afterLast : today;
    try {
      const [created] = await db
        .insert(sessions)
        .values({ clubId, number: (last?.number ?? 0) + 1, date: nextOccurrence(club.slowNight, from), checkInCode: generateCheckInCode() })
        .returning();
      return created;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new HttpError(503, "We could not open the session just now. Please try again.");
}

export async function listSessions(db: Db, clubId: string): Promise<SessionRow[]> {
  return db.select().from(sessions).where(eq(sessions.clubId, clubId)).orderBy(sessions.number);
}
