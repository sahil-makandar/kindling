import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/src/db/client";
import { sessions } from "@/src/db/schema";
import { getClub, type ClubView } from "@/src/clubs/state";
import type { Recommendation, Proposal } from "./coach";
import { latestRecommendation, loadWeeks } from "./repo";
import type { SessionStats } from "./signals";
import type { WeeksTiles } from "./weeks";

// Everything the weekly page needs, as plain data. Reading it never calls the model or Qloo.

export type WeeklyView = {
  club: ClubView;
  nights: Array<SessionStats & { id: string }>;
  tiles: WeeksTiles;
  anySimulated: boolean;
  recommendation: Recommendation | null;
  // The coming night, with the variant the owner accepted, if any.
  next: { id: string; number: number; date: string; checkInCode: string; variant: Proposal | null } | null;
  roomTags: Array<{ name: string; weight: number }>;
  roomFavourites: string[];
};

export async function getWeeklyView(db: Db, clubId: string): Promise<WeeklyView | null> {
  const club = await getClub(db, clubId);
  if (!club) return null;
  const data = await loadWeeks(db, clubId);
  if (!data) return null;

  const [next] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.clubId, clubId), eq(sessions.status, "open")))
    .orderBy(desc(sessions.number))
    .limit(1);

  return {
    club,
    nights: data.weeks.sessions,
    tiles: data.weeks.tiles,
    anySimulated: data.weeks.anySimulated,
    recommendation: await latestRecommendation(db, clubId),
    next: next ? { id: next.id, number: next.number, date: next.date, checkInCode: next.checkInCode, variant: (next.variant as Proposal | null) ?? null } : null,
    roomTags: data.weeks.roomVector.slice(0, 8).map((t) => ({ name: t.name, weight: t.weight })),
    roomFavourites: data.weeks.roomFavourites.map((f) => f.name),
  };
}
