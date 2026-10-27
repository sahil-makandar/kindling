import { regularsMade, returnRateOf, strangersSeated, type SessionStats } from "./signals";
import { sumVectors, type Favourite, type TasteVector } from "@/src/seating/tasteVector";

// Turns a club's sessions and check-ins into the numbers the weekly page and the Coach use. Pure: the database
// loader hands it plain rows.

export type RawSession = {
  id: string;
  number: number;
  date: string;
  status: "open" | "closed";
  simulated: boolean;
  headcountManual: number | null;
  vibeRating: number | null;
};

export type RawCheckin = {
  sessionId: string;
  attendeeId: string;
  tableNo: number | null;
  consent: boolean;
  vector: TasteVector | null;
  favourites: Favourite[];
};

export type RoomFavourite = Favourite & { count: number };

export type WeeksTiles = {
  regularsMade: number;
  returnRate: number;
  // The latest night's attendance, and what the owner said a normal night of that day looks like.
  seatsFilled: number;
  baseline: number | null;
  strangersSeated: number;
};

export type Weeks = {
  // Nights with at least one check-in, oldest first. An upcoming empty night is not a week of data.
  sessions: Array<SessionStats & { id: string }>;
  tiles: WeeksTiles;
  visitsPerPerson: Map<string, number>;
  // The latest night's combined taste and most-loved picks.
  roomVector: TasteVector;
  roomFavourites: RoomFavourite[];
  latestSessionId: string | null;
  anySimulated: boolean;
};

const TOP_FAVOURITES = 6;

export function buildWeeks(args: { sessions: readonly RawSession[]; checkins: readonly RawCheckin[]; baseline: number | null }): Weeks {
  const ordered = [...args.sessions].sort((a, b) => a.number - b.number);
  const bySession = new Map<string, RawCheckin[]>();
  for (const c of args.checkins) bySession.set(c.sessionId, [...(bySession.get(c.sessionId) ?? []), c]);
  const held = ordered.filter((s) => (bySession.get(s.id)?.length ?? 0) > 0);

  const seen = new Set<string>();
  const sessions = held.map((s) => {
    const people = [...new Set((bySession.get(s.id) ?? []).map((c) => c.attendeeId))];
    const returning = people.filter((id) => seen.has(id)).length;
    for (const id of people) seen.add(id);
    return {
      id: s.id,
      number: s.number,
      date: s.date,
      attendance: Math.max(people.length, s.headcountManual ?? 0),
      checkedIn: people.length,
      returning,
      simulated: s.simulated,
      vibeRating: s.vibeRating,
    };
  });

  const visitsPerPerson = new Map<string, number>();
  for (const c of args.checkins) visitsPerPerson.set(c.attendeeId, (visitsPerPerson.get(c.attendeeId) ?? 0) + 1);

  const tables = held.map((s) => {
    const groups = new Map<number, string[]>();
    for (const c of bySession.get(s.id) ?? []) {
      if (c.consent && c.vector && c.tableNo !== null) groups.set(c.tableNo, [...(groups.get(c.tableNo) ?? []), c.attendeeId]);
    }
    return [...groups.values()];
  });

  const latest = held.at(-1) ?? null;
  const latestRows = latest ? (bySession.get(latest.id) ?? []) : [];
  const counts = new Map<string, RoomFavourite>();
  for (const row of latestRows) {
    for (const fav of new Map(row.favourites.map((f) => [f.id, f])).values()) {
      const known = counts.get(fav.id);
      counts.set(fav.id, { id: fav.id, name: known?.name ?? fav.name, count: (known?.count ?? 0) + 1 });
    }
  }

  const lastStats = sessions.at(-1);
  return {
    sessions,
    tiles: {
      regularsMade: regularsMade(visitsPerPerson),
      returnRate: lastStats ? returnRateOf(lastStats) : 0,
      seatsFilled: lastStats?.attendance ?? 0,
      baseline: args.baseline,
      strangersSeated: strangersSeated(tables),
    },
    visitsPerPerson,
    roomVector: sumVectors(latestRows.flatMap((r) => (r.vector ? [r.vector] : []))),
    roomFavourites: [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, TOP_FAVOURITES),
    latestSessionId: latest?.id ?? null,
    anySimulated: held.some((s) => s.simulated),
  };
}
