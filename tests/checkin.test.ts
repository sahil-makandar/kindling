import { describe, expect, it } from "vitest";
import { checkIn, sharedLine, type CheckInDeps, type CheckInRepo, type SeatOutcome, type SessionInfo } from "@/src/checkin/checkIn";
import { clearDeviceCookie, deviceCookie, readDeviceToken } from "@/src/checkin/cookie";
import { checkInSchema } from "@/src/checkin/schema";
import { explainTable, placeAttendee, type Seating } from "@/src/seating/assignTables";
import { toVector, type Person, type TasteVector } from "@/src/seating/tasteVector";

const GHIBLI = toVector([{ name: "Anime", affinity: 1 }, { name: "Studio Ghibli", affinity: 0.9 }, { name: "Fantasy", affinity: 0.6 }]);
const SOUL = toVector([{ name: "Soul", affinity: 1 }, { name: "Jazz", affinity: 0.8 }]);

const session: SessionInfo = { id: "s1", clubId: "c1", status: "open", date: "2026-10-27", clubTitle: "Ghibli Tuesdays", venueName: "The Slow Pour" };

type MemoryRow = { checkinId: string; attendeeId: string; nickname: string; person: Person; consent: boolean; table: number | null };

function memoryRepo(initial: Partial<SessionInfo> = {}) {
  const info = { ...session, ...initial };
  const attendees = new Map<string, { nickname: string; token: string | null }>();
  const rows: MemoryRow[] = [];
  let seating: Seating = { tables: [], waiting: [] };
  let n = 0;

  const repo: CheckInRepo = {
    async loadSession(code) {
      return code === "ABCD2345" ? info : null;
    },
    async findAttendeeByToken(token) {
      const found = [...attendees.entries()].find(([, a]) => a.token === token);
      return found ? { id: found[0], nickname: found[1].nickname } : null;
    },
    async createAttendee(nickname, token) {
      n += 1;
      attendees.set(`a${n}`, { nickname, token });
      return `a${n}`;
    },
    async renameAttendee(id, nickname) {
      const a = attendees.get(id);
      if (a) a.nickname = nickname;
    },
    async saveAndSeat(args): Promise<SeatOutcome> {
      const existing = rows.find((r) => r.attendeeId === args.attendeeId);
      if (existing) {
        const mates = rows.filter((r) => r.table !== null && r.table === existing.table && r !== existing);
        return { checkinId: existing.checkinId, alreadyCheckedIn: true, table: existing.table, waiting: false, tablemates: mates.map((m) => m.nickname), explanation: null, favourites: args.favourites };
      }
      const checkinId = `k${rows.length + 1}`;
      const person: Person = { id: checkinId, favourites: args.favourites.map((f) => ({ id: f.id, name: f.name })), vector: args.vector ?? [] };
      const row: MemoryRow = { checkinId, attendeeId: args.attendeeId, nickname: args.nickname, person, consent: args.consentSeating, table: null };
      if (args.consentSeating && args.vector) {
        const others = rows.filter((r) => r.consent && r.person.vector.length > 0).map((r) => r.person);
        const placed = placeAttendee(others, seating, person);
        seating = placed.seating;
        for (const r of rows) r.table = seating.tables.find((t) => t.memberIds.includes(r.checkinId))?.number ?? null;
        row.table = seating.tables.find((t) => t.memberIds.includes(checkinId))?.number ?? null;
      }
      rows.push(row);
      const mates = rows.filter((r) => r.table !== null && r.table === row.table && r !== row);
      const everyone = rows.filter((r) => r.table !== null && r.table === row.table).map((r) => r.person);
      return {
        checkinId,
        alreadyCheckedIn: false,
        table: row.table,
        waiting: Boolean(args.consentSeating && args.vector && row.table === null),
        tablemates: mates.map((m) => m.nickname),
        explanation: everyone.length >= 2 ? explainTable(everyone) : null,
        favourites: args.favourites,
      };
    },
  };
  return { repo, rows, attendees };
}

const favs = (...names: string[]) => names.map((name) => ({ id: `fx_${name.toLowerCase().replace(/\W+/g, "_")}`, name, domain: "movie" as const }));

const body = (over: Record<string, unknown> = {}) => ({
  code: "abcd-2345",
  nickname: "Sam",
  favourites: favs("Spirited Away", "Nujabes", "Ramen"),
  consentSeating: true,
  remember: false,
  ...over,
});

function deps(repo: CheckInRepo, taste: (ids: string[]) => Promise<TasteVector> = async () => GHIBLI, extra: Partial<CheckInDeps> = {}): CheckInDeps {
  return { repo, tasteFor: taste, newToken: () => "11111111-1111-1111-1111-111111111111", ...extra };
}

describe("check-in input", () => {
  it("wants exactly three different favourites and a name", () => {
    expect(checkInSchema.safeParse(body()).success).toBe(true);
    expect(checkInSchema.safeParse(body({ favourites: favs("A", "B") })).success).toBe(false);
    expect(checkInSchema.safeParse(body({ favourites: [...favs("A", "B"), ...favs("A")] })).success).toBe(false);
    expect(checkInSchema.safeParse(body({ nickname: "   " })).success).toBe(false);
    expect(checkInSchema.safeParse(body({ nickname: "x".repeat(31) })).success).toBe(false);
  });

  it("cleans the name before it is shown to a table", () => {
    const parsed = checkInSchema.parse(body({ nickname: "  <b>Sam</b>\n  Jones  " }));
    expect(parsed.nickname).toBe("bSam/b Jones");
  });
});

describe("checkIn", () => {
  it("seats the first guest, then puts a second guest with overlapping taste at the same table with a shared line", async () => {
    const { repo } = memoryRepo();
    const first = await checkIn(body({ nickname: "Sam" }), deps(repo));
    expect(first).toMatchObject({ state: "first", table: 1, tablemates: [], clubTitle: "Ghibli Tuesdays" });
    expect(first.message).toContain("first here");

    const second = await checkIn(body({ nickname: "Ana", favourites: favs("Spirited Away", "Totoro", "Tea") }), deps(repo));
    expect(second).toMatchObject({ state: "seated", table: 1, tablemates: ["Sam"] });
    expect(second.sharedLine).toBe("You all love: Spirited Away, Anime, Studio Ghibli.");
    expect(second.nameTag).toBe("Ask me about Spirited Away");
  });

  it("puts guests with a different taste at another table once nobody is alone", async () => {
    const { repo } = memoryRepo();
    await checkIn(body({ nickname: "Sam" }), deps(repo));
    await checkIn(body({ nickname: "Ana", favourites: favs("Totoro", "Tea", "Cake") }), deps(repo));
    const jazz = await checkIn(body({ nickname: "Lee", favourites: favs("Kind of Blue", "Miles", "Wine") }), deps(repo, async () => SOUL));
    expect(jazz.table).toBe(2);
    expect(jazz.state).toBe("first");
  });

  it("does not ask Qloo or seat a guest who did not tick the box", async () => {
    const { repo, rows } = memoryRepo();
    let asked = 0;
    const result = await checkIn(body({ consentSeating: false }), deps(repo, async () => ((asked += 1), GHIBLI)));
    expect(asked).toBe(0);
    expect(result).toMatchObject({ state: "free", table: null });
    expect(result.message).toContain("You chose not to be matched");
    expect(rows[0].table).toBeNull();
  });

  it("falls back to free seating when Qloo is slow, with the promised message", async () => {
    const { repo } = memoryRepo();
    const slow = () => new Promise<TasteVector>(() => undefined);
    const result = await checkIn(body(), deps(repo, slow, { timeoutMs: 20 }));
    expect(result).toMatchObject({ state: "free", table: null, message: "Grab any seat tonight; we'll match you next time." });
  });

  it("falls back the same way when Qloo fails or knows nothing about the picks", async () => {
    const failed = await checkIn(body(), deps(memoryRepo().repo, async () => Promise.reject(new Error("boom"))));
    expect(failed.state).toBe("free");
    const empty = await checkIn(body(), deps(memoryRepo().repo, async () => []));
    expect(empty.state).toBe("free");
  });

  it("sends only favourite ids to the taste lookup, sorted, never the name", async () => {
    const { repo } = memoryRepo();
    let received: string[] = [];
    await checkIn(body({ nickname: "Zed" }), deps(repo, async () => ((received = []), GHIBLI)));
    await checkIn(body({ nickname: "Yan", favourites: favs("Zebra", "Apple", "Mango") }), deps(repo, async (ids) => ((received = ids), GHIBLI)));
    expect(received).toEqual(["fx_apple", "fx_mango", "fx_zebra"]);
    expect(received.join(" ")).not.toContain("Yan");
  });

  it("refuses an unknown code and a closed session in plain words", async () => {
    await expect(checkIn(body({ code: "ZZZZ9999" }), deps(memoryRepo().repo))).rejects.toMatchObject({ status: 404 });
    await expect(checkIn(body(), deps(memoryRepo({ status: "closed" }).repo))).rejects.toMatchObject({ status: 409, message: expect.stringContaining("closed") });
  });

  it("is the same person on a second check-in with the same remembered device", async () => {
    const { repo, rows, attendees } = memoryRepo();
    const first = await checkIn(body({ remember: true }), deps(repo));
    expect(first).toMatchObject({ deviceToken: "11111111-1111-1111-1111-111111111111" });
    const again = await checkIn(body({ remember: true, nickname: "Samuel" }), deps(repo, undefined, { deviceToken: "11111111-1111-1111-1111-111111111111" }));
    expect(attendees.size).toBe(1);
    expect(attendees.get("a1")?.nickname).toBe("Samuel");
    expect(rows).toHaveLength(1);
    expect(again.checkinId).toBe(first.checkinId);
  });

  it("does not keep a device token unless the guest asked to be remembered", async () => {
    const { repo, attendees } = memoryRepo();
    const result = await checkIn(body({ remember: false }), deps(repo, undefined, { deviceToken: "11111111-1111-1111-1111-111111111111" }));
    expect(result.deviceToken).toBeNull();
    expect([...attendees.values()][0].token).toBeNull();
  });
});

describe("sharedLine", () => {
  it("says 'you all' only when everyone shares, and names at most three things", () => {
    const people: Person[] = [
      { id: "a", vector: GHIBLI, favourites: [{ id: "1", name: "Spirited Away" }] },
      { id: "b", vector: GHIBLI, favourites: [{ id: "1", name: "Spirited Away" }] },
    ];
    expect(sharedLine(explainTable(people))).toBe("You all love: Spirited Away, Anime, Studio Ghibli.");
    const mixed = [...people, { id: "c", vector: SOUL, favourites: [] }];
    expect(sharedLine(explainTable(mixed))).toMatch(/^Some of you share a love of: /);
    expect(sharedLine(explainTable([people[0]]))).toBeNull();
    // Two of three share a film: that must not be called something they all love.
    const partial: Person[] = [
      { id: "a", vector: [], favourites: [{ id: "1", name: "Sade" }] },
      { id: "b", vector: [], favourites: [{ id: "1", name: "Sade" }] },
      { id: "c", vector: [], favourites: [{ id: "2", name: "Other" }] },
    ];
    expect(sharedLine(explainTable(partial))).toBe("Some of you share a love of: Sade.");
    expect(sharedLine(null)).toBeNull();
  });
});

describe("device cookie", () => {
  const token = "11111111-1111-1111-1111-111111111111";

  it("reads only a well-formed token and ignores other cookies", () => {
    expect(readDeviceToken(`a=1; device_token=${token}; b=2`)).toBe(token);
    expect(readDeviceToken("device_token=not-a-token")).toBeNull();
    expect(readDeviceToken(null)).toBeNull();
  });

  it("is first-party, not readable by scripts, and a year long", () => {
    const cookie = deviceCookie(token, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=31536000");
    expect(deviceCookie(token, false)).not.toContain("Secure");
    expect(clearDeviceCookie(false)).toContain("Max-Age=0");
  });
});
