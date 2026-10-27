import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/src/db/client";
import { attendees, checkins, clubs, sessions, venues } from "@/src/db/schema";
import { HttpError } from "@/src/runs/http";
import { assignTables, explainTable, placeAttendee, type Seating, type TableExplanation } from "@/src/seating/assignTables";
import type { Favourite, Person, TasteVector } from "@/src/seating/tasteVector";
import type { CheckInRepo, SessionInfo } from "./checkIn";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

type Row = {
  checkinId: string;
  attendeeId: string;
  nickname: string;
  favourites: Favourite[];
  vector: TasteVector | null;
  consent: boolean;
  tableNo: number | null;
};

async function loadRows(db: Executor, sessionId: string): Promise<Row[]> {
  const rows = await db
    .select({ checkin: checkins, nickname: attendees.nickname })
    .from(checkins)
    .innerJoin(attendees, eq(attendees.id, checkins.attendeeId))
    .where(eq(checkins.sessionId, sessionId))
    .orderBy(asc(checkins.createdAt), asc(checkins.id));
  return rows.map(({ checkin, nickname }) => ({
    checkinId: checkin.id,
    attendeeId: checkin.attendeeId,
    nickname,
    favourites: ((checkin.favourites ?? []) as Favourite[]).map((f) => ({ id: f.id, name: f.name })),
    vector: (checkin.tagVector as TasteVector | null) ?? null,
    consent: checkin.consentSeating,
    tableNo: checkin.tableNo,
  }));
}

// Guests who have been to this club on an earlier night are regulars, and seating spreads them across tables.
async function regularIds(db: Executor, clubId: string, sessionId: string, attendeeIds: string[]): Promise<Set<string>> {
  if (attendeeIds.length === 0) return new Set();
  const rows = await db
    .select({ attendeeId: checkins.attendeeId, n: count() })
    .from(checkins)
    .innerJoin(sessions, eq(sessions.id, checkins.sessionId))
    .where(and(eq(sessions.clubId, clubId), ne(sessions.id, sessionId), inArray(checkins.attendeeId, attendeeIds)))
    .groupBy(checkins.attendeeId);
  return new Set(rows.filter((r) => r.n > 0).map((r) => r.attendeeId));
}

const lock = (tx: Tx, sessionId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${sessionId}))`);

const toPerson = (row: Row, regulars: Set<string>): Person => ({ id: row.checkinId, favourites: row.favourites, vector: row.vector ?? [], regular: regulars.has(row.attendeeId) });

// The seating as stored: people with a table number are seated, people matched but without one are waiting.
function currentSeating(rows: Row[]): Seating {
  const seated = rows.filter((r) => r.consent && r.vector && r.tableNo !== null);
  const numbers = [...new Set(seated.map((r) => r.tableNo as number))].sort((a, b) => a - b);
  return {
    tables: numbers.map((no, index) => {
      const members = seated.filter((r) => r.tableNo === no);
      return { number: index + 1, memberIds: members.map((r) => r.checkinId), explanation: explainTable(members.map((m) => toPerson(m, new Set()))) };
    }),
    waiting: rows.filter((r) => r.consent && r.vector && r.tableNo === null).map((r) => r.checkinId),
  };
}

async function writeTables(tx: Tx, rows: Row[], seating: Seating): Promise<void> {
  const target = new Map<string, number | null>(rows.map((r) => [r.checkinId, null]));
  for (const table of seating.tables) for (const id of table.memberIds) target.set(id, table.number);
  for (const row of rows) {
    if (!row.consent || !row.vector) continue;
    const next = target.get(row.checkinId) ?? null;
    if (next !== row.tableNo) await tx.update(checkins).set({ tableNo: next }).where(eq(checkins.id, row.checkinId));
  }
}

export function createDbCheckInRepo(db: Db): CheckInRepo {
  return {
    async loadSession(code) {
      const [row] = await db
        .select({ session: sessions, clubTitle: clubs.title, venueName: venues.name })
        .from(sessions)
        .innerJoin(clubs, eq(clubs.id, sessions.clubId))
        .innerJoin(venues, eq(venues.id, clubs.venueId))
        .where(eq(sessions.checkInCode, code));
      if (!row) return null;
      return { id: row.session.id, clubId: row.session.clubId, status: row.session.status, date: row.session.date, clubTitle: row.clubTitle, venueName: row.venueName } satisfies SessionInfo;
    },

    async findAttendeeByToken(token) {
      const [row] = await db.select({ id: attendees.id, nickname: attendees.nickname }).from(attendees).where(eq(attendees.deviceToken, token));
      return row ?? null;
    },

    async createAttendee(nickname, token) {
      const [row] = await db.insert(attendees).values({ nickname, deviceToken: token }).returning({ id: attendees.id });
      return row.id;
    },

    async renameAttendee(id, nickname) {
      await db.update(attendees).set({ nickname }).where(eq(attendees.id, id));
    },

    saveAndSeat(args) {
      return db.transaction(async (tx) => {
        await lock(tx, args.session.id);
        const before = await loadRows(tx, args.session.id);

        const existing = before.find((r) => r.attendeeId === args.attendeeId);
        let rows = before;
        let checkinId: string;
        const alreadyCheckedIn = existing !== undefined;
        if (existing) {
          checkinId = existing.checkinId;
        } else {
          const [created] = await tx
            .insert(checkins)
            .values({ sessionId: args.session.id, attendeeId: args.attendeeId, favourites: args.favourites, tagVector: args.vector, consentSeating: args.consentSeating })
            .returning({ id: checkins.id });
          checkinId = created.id;
          rows = [
            ...before,
            { checkinId, attendeeId: args.attendeeId, nickname: args.nickname, favourites: args.favourites.map((f) => ({ id: f.id, name: f.name })), vector: args.vector, consent: args.consentSeating, tableNo: null },
          ];
          if (args.consentSeating && args.vector) {
            const regulars = await regularIds(tx, args.session.clubId, args.session.id, rows.map((r) => r.attendeeId));
            const others = before.filter((r) => r.consent && r.vector).map((r) => toPerson(r, regulars));
            const newcomer = toPerson(rows[rows.length - 1], regulars);
            const placed = placeAttendee(others, currentSeating(before), newcomer);
            await writeTables(tx, rows, placed.seating);
            rows = (await loadRows(tx, args.session.id)).map((r) => r);
          }
        }

        const me = rows.find((r) => r.checkinId === checkinId);
        const table = me?.tableNo ?? null;
        const mates = table === null ? [] : rows.filter((r) => r.tableNo === table && r.checkinId !== checkinId);
        const everyone = table === null ? [] : rows.filter((r) => r.tableNo === table).map((r) => toPerson(r, new Set()));
        return {
          checkinId,
          alreadyCheckedIn,
          table,
          waiting: Boolean(me && me.consent && me.vector && table === null),
          tablemates: mates.map((m) => m.nickname),
          explanation: everyone.length >= 2 ? explainTable(everyone) : null,
          favourites: me?.favourites ?? [],
        };
      });
    },
  };
}

// ---- host views ----

export type BoardTable = { number: number; members: Array<{ checkinId: string; nickname: string; regular: boolean }>; explanation: TableExplanation };

export type Board = {
  session: { id: string; clubId: string; number: number; date: string; status: "open" | "closed"; checkInCode: string; simulated: boolean; headcountManual: number | null; vibeRating: number | null };
  tables: BoardTable[];
  waiting: Array<{ checkinId: string; nickname: string }>;
  // Checked in but not matched: they did not tick the box, or Qloo was slow.
  free: Array<{ checkinId: string; nickname: string }>;
  checkedIn: number;
};

export async function loadBoard(db: Db, sessionId: string): Promise<Board | null> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return null;
  const rows = await loadRows(db, sessionId);
  const regulars = await regularIds(db, session.clubId, sessionId, rows.map((r) => r.attendeeId));
  const seated = rows.filter((r) => r.consent && r.vector && r.tableNo !== null);
  const numbers = [...new Set(seated.map((r) => r.tableNo as number))].sort((a, b) => a - b);
  return {
    session: {
      id: session.id,
      clubId: session.clubId,
      number: session.number,
      date: session.date,
      status: session.status,
      checkInCode: session.checkInCode,
      simulated: session.simulated,
      headcountManual: session.headcountManual,
      vibeRating: session.vibeRating,
    },
    tables: numbers.map((no) => {
      const members = seated.filter((r) => r.tableNo === no);
      return {
        number: no,
        members: members.map((m) => ({ checkinId: m.checkinId, nickname: m.nickname, regular: regulars.has(m.attendeeId) })),
        explanation: explainTable(members.map((m) => toPerson(m, regulars))),
      };
    }),
    waiting: rows.filter((r) => r.consent && r.vector && r.tableNo === null).map((r) => ({ checkinId: r.checkinId, nickname: r.nickname })),
    free: rows.filter((r) => !(r.consent && r.vector)).map((r) => ({ checkinId: r.checkinId, nickname: r.nickname })),
    checkedIn: rows.length,
  };
}

// Re-runs seating for everyone who asked to be matched. The host sees the new tables and tells people to move.
export async function rebalanceSession(db: Db, sessionId: string): Promise<Board> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) throw new HttpError(404, "We could not find that session.");
  await db.transaction(async (tx) => {
    await lock(tx, sessionId);
    const rows = await loadRows(tx, sessionId);
    const regulars = await regularIds(tx, session.clubId, sessionId, rows.map((r) => r.attendeeId));
    const people = rows.filter((r) => r.consent && r.vector).map((r) => toPerson(r, regulars));
    await writeTables(tx, rows, assignTables(people));
  });
  const board = await loadBoard(db, sessionId);
  if (!board) throw new HttpError(404, "We could not find that session.");
  return board;
}

// "Forget me": removes the guest and everything they checked in with. The check-in id is the proof they hold.
export async function forgetByCheckin(db: Db, checkinId: string): Promise<boolean> {
  const [row] = await db.select({ attendeeId: checkins.attendeeId }).from(checkins).where(eq(checkins.id, checkinId));
  if (!row) return false;
  await db.delete(attendees).where(eq(attendees.id, row.attendeeId));
  return true;
}

export async function findReturning(db: Db, token: string): Promise<{ nickname: string } | null> {
  const [row] = await db.select({ nickname: attendees.nickname }).from(attendees).where(eq(attendees.deviceToken, token));
  return row ?? null;
}

// ---- closing the night ----

export const closeSessionSchema = z.object({
  headcount: z.number().int("Use a whole number.").min(0, "Use 0 or more.").max(1000, "That is more than we can plan for.").optional(),
  vibe: z.number().int().min(1, "Rate the night from 1 to 5.").max(5, "Rate the night from 1 to 5.").optional(),
});

// Ends check-in for the night and records what the host saw: how many people really came, and how the night felt.
export async function closeSession(db: Db, sessionId: string, raw: unknown): Promise<Board> {
  const input = closeSessionSchema.parse(raw);
  const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, sessionId));
  if (!session) throw new HttpError(404, "We could not find that session.");
  await db
    .update(sessions)
    .set({ status: "closed", ...(input.headcount !== undefined ? { headcountManual: input.headcount } : {}), ...(input.vibe !== undefined ? { vibeRating: input.vibe } : {}) })
    .where(eq(sessions.id, sessionId));
  const board = await loadBoard(db, sessionId);
  if (!board) throw new HttpError(404, "We could not find that session.");
  return board;
}
