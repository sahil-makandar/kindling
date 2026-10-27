import { randomUUID } from "node:crypto";
import type { Favourite, TasteVector } from "@/src/seating/tasteVector";
import type { TableExplanation } from "@/src/seating/assignTables";
import { HttpError } from "@/src/runs/http";
import { normaliseCode } from "@/src/clubs/sessions";
import { checkInSchema, type FavouriteInput } from "./schema";

// Check-in: a guest gives a name and three favourites and is seated with people who share their taste. The orchestration
// is here with the storage and Qloo behind small interfaces, so it is tested without a database or the network.

export const TASTE_TIMEOUT_MS = 12_000;

export type SessionInfo = {
  id: string;
  clubId: string;
  status: "open" | "closed";
  date: string;
  clubTitle: string;
  venueName: string;
};

export type SaveArgs = {
  session: SessionInfo;
  attendeeId: string;
  nickname: string;
  favourites: FavouriteInput[];
  // null when the guest did not want to be matched, or Qloo did not answer in time.
  vector: TasteVector | null;
  consentSeating: boolean;
};

export type SeatOutcome = {
  checkinId: string;
  alreadyCheckedIn: boolean;
  table: number | null;
  waiting: boolean;
  // First names of the others at the table.
  tablemates: string[];
  explanation: TableExplanation | null;
  favourites: Favourite[];
};

export type CheckInRepo = {
  loadSession(code: string): Promise<SessionInfo | null>;
  findAttendeeByToken(token: string): Promise<{ id: string; nickname: string } | null>;
  createAttendee(nickname: string, token: string | null): Promise<string>;
  renameAttendee(id: string, nickname: string): Promise<void>;
  // Saves the check-in and seats the person in one step that no other check-in can interleave with.
  saveAndSeat(args: SaveArgs): Promise<SeatOutcome>;
};

export type CheckInDeps = {
  repo: CheckInRepo;
  // The guest's taste from their favourites. Throws when Qloo cannot answer.
  tasteFor(favouriteIds: string[]): Promise<TasteVector>;
  timeoutMs?: number;
  newToken?: () => string;
  // A device token the browser already holds, if the guest was remembered before.
  deviceToken?: string | null;
};

export type CheckInResult = {
  checkinId: string;
  nickname: string;
  state: "seated" | "first" | "waiting" | "free";
  table: number | null;
  tablemates: string[];
  sharedLine: string | null;
  nameTag: string;
  message: string;
  clubTitle: string;
  // Set when the guest asked to be remembered; the route stores it in a cookie.
  deviceToken: string | null;
};

// "You all love: Wong Kar-wai, city pop, ramen." Shared favourites first, then shared tags, at most three items.
// "You all love" only names things every person at the table has; otherwise the line says some of them share it.
export function sharedLine(explanation: TableExplanation | null): string | null {
  if (!explanation) return null;
  const items: Array<{ name: string; count: number }> = [];
  for (const fav of explanation.sharedFavourites) items.push(fav);
  for (const tag of explanation.sharedTags) if (!items.some((i) => i.name.toLowerCase() === tag.name.toLowerCase())) items.push(tag);
  const everyone = items.filter((i) => i.count >= explanation.size).map((i) => i.name);
  if (everyone.length > 0) return `You all love: ${everyone.slice(0, 3).join(", ")}.`;
  const some = items.map((i) => i.name).slice(0, 3);
  return some.length > 0 ? `Some of you share a love of: ${some.join(", ")}.` : null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve("timeout"), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function checkIn(raw: unknown, deps: CheckInDeps): Promise<CheckInResult> {
  const input = checkInSchema.parse(raw);
  const { repo } = deps;

  const session = await repo.loadSession(normaliseCode(input.code));
  if (!session) throw new HttpError(404, "We could not find that check-in code. Scan the poster again or ask the host.");
  if (session.status === "closed") throw new HttpError(409, "Tonight's session is closed. Ask the host to open it, or come back next week.");

  // Who is this? A remembered device is one person across weeks; anyone else is new each night.
  let token = deps.deviceToken ?? null;
  let attendeeId: string | null = null;
  if (input.remember && token) {
    const known = await repo.findAttendeeByToken(token);
    if (known) {
      attendeeId = known.id;
      if (known.nickname !== input.nickname) await repo.renameAttendee(known.id, input.nickname);
    }
  }
  if (!attendeeId) {
    token = input.remember ? (deps.newToken ?? randomUUID)() : null;
    attendeeId = await repo.createAttendee(input.nickname, token);
  }

  // Qloo is asked only when the guest wants to be matched, and only for the ids of what they picked.
  let vector: TasteVector | null = null;
  let tasteSlow = false;
  if (input.consentSeating) {
    try {
      const answer = await withTimeout(deps.tasteFor(input.favourites.map((f) => f.id).sort()), deps.timeoutMs ?? TASTE_TIMEOUT_MS);
      if (answer === "timeout" || answer.length === 0) tasteSlow = true;
      else vector = answer;
    } catch {
      tasteSlow = true;
    }
  }

  const outcome = await repo.saveAndSeat({
    session,
    attendeeId,
    nickname: input.nickname,
    favourites: input.favourites,
    vector,
    consentSeating: input.consentSeating,
  });

  const nameTag = `Ask me about ${outcome.favourites[0]?.name ?? input.favourites[0].name}`;
  const base = {
    checkinId: outcome.checkinId,
    nickname: input.nickname,
    nameTag,
    clubTitle: session.clubTitle,
    deviceToken: input.remember ? token : null,
  };

  if (!input.consentSeating) {
    return { ...base, state: "free", table: null, tablemates: [], sharedLine: null, message: "Sit anywhere you like tonight. You chose not to be matched." };
  }
  if (tasteSlow || outcome.table === null && !outcome.waiting) {
    return { ...base, state: "free", table: null, tablemates: [], sharedLine: null, message: "Grab any seat tonight; we'll match you next time." };
  }
  if (outcome.waiting) {
    return { ...base, state: "waiting", table: null, tablemates: [], sharedLine: null, message: "Tables are full right now. Grab a seat at the bar, we'll seat you in a minute." };
  }
  if (outcome.tablemates.length === 0) {
    return { ...base, state: "first", table: outcome.table, tablemates: [], sharedLine: null, message: `You're at table ${outcome.table}. You are first here, so others will join you soon.` };
  }
  return { ...base, state: "seated", table: outcome.table, tablemates: outcome.tablemates, sharedLine: sharedLine(outcome.explanation), message: `You're at table ${outcome.table}.` };
}
