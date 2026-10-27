import { describe, expect, it } from "vitest";
import { buildSignals, consecutiveDeclines, decide, driftOf, regularsMade, returnRateOf, slope, strangersSeated, trendOf, type CoachSignals, type SessionStats } from "@/src/coach/signals";
import { toVector } from "@/src/seating/tasteVector";
import { buildWeeks, type RawCheckin, type RawSession } from "@/src/coach/weeks";

const signals = (over: Partial<CoachSignals> = {}): CoachSignals => ({ sessions: 4, attendance: [9, 13, 16, 21], trend: 4, declines: 0, returnRate: 0.48, drift: 0.3, regularsMade: 6, ...over });

describe("trend", () => {
  it("is the slope over the last three nights", () => {
    expect(slope([1, 2, 3])).toBe(1);
    expect(slope([5])).toBe(0);
    expect(trendOf([9, 13, 16, 21])).toBe(4);
    expect(trendOf([20, 18, 12])).toBe(-4);
    expect(trendOf([10, 10, 10])).toBe(0);
    expect(trendOf([])).toBe(0);
  });

  it("counts nights of falling attendance in a row from the latest", () => {
    expect(consecutiveDeclines([9, 13, 16, 21])).toBe(0);
    expect(consecutiveDeclines([20, 18, 12])).toBe(2);
    expect(consecutiveDeclines([20, 18, 12, 15])).toBe(0);
    expect(consecutiveDeclines([20, 12, 12])).toBe(0);
    expect(consecutiveDeclines([5])).toBe(0);
  });
});

describe("return rate, regulars, strangers", () => {
  it("divides returning guests by everyone, and handles an empty night", () => {
    expect(returnRateOf({ checkedIn: 21, returning: 10 })).toBe(0.476);
    expect(returnRateOf({ checkedIn: 0, returning: 0 })).toBe(0);
  });

  it("counts people with three or more visits as regulars", () => {
    expect(regularsMade(new Map([["a", 4], ["b", 3], ["c", 2], ["d", 1]]))).toBe(2);
    expect(regularsMade([3, 3, 2])).toBe(2);
    expect(regularsMade(new Map())).toBe(0);
  });

  it("counts a pair as a new acquaintance only the first time they share a table", () => {
    const night1 = [["a", "b", "c"], ["d", "e"]];
    const night2 = [["a", "b", "d"], ["c", "e"]];
    // night 1: ab ac bc de = 4. night 2: ab (met), ad (new), bd (new), ce (new) = 3.
    expect(strangersSeated([night1])).toBe(4);
    expect(strangersSeated([night1, night2])).toBe(7);
    expect(strangersSeated([night1, night1])).toBe(4);
    expect(strangersSeated([])).toBe(0);
  });

  it("does not count the same pair twice on one night", () => {
    expect(strangersSeated([[["a", "b"], ["b", "a"]]])).toBe(1);
  });
});

describe("drift", () => {
  const club = toVector([{ name: "Anime", affinity: 1 }, { name: "Lo-fi", affinity: 0.6 }]);
  it("is 0 when the room matches the club and near 1 when it does not", () => {
    expect(driftOf(club, club)).toBe(0);
    expect(driftOf(toVector([{ name: "Metal", affinity: 1 }]), club)).toBe(1);
    expect(driftOf([], club)).toBe(0);
  });
});

describe("decide", () => {
  it("keeps a growing club that people come back to (the demo numbers)", () => {
    const result = decide(signals());
    expect(result.decision).toBe("keep");
    expect(result.reasons[0]).toContain("48%");
    expect(result.reasons[0]).toContain("growing");
  });

  it("keeps even when the room has drifted, if the club is healthy", () => {
    expect(decide(signals({ drift: 0.9 })).decision).toBe("keep");
  });

  it("tweaks when the room has drifted and attendance is only holding", () => {
    const result = decide(signals({ trend: 0, returnRate: 0.25, drift: 0.8 }));
    expect(result.decision).toBe("tweak");
    expect(result.reasons[0]).toContain("0.80");
  });

  it("tweaks a slipping club that has not yet lost its regulars", () => {
    const result = decide(signals({ trend: -2, declines: 1, returnRate: 0.35, drift: 0.2 }));
    expect(result.decision).toBe("tweak");
    expect(result.reasons[0]).toContain("slipping");
  });

  it("switches after two falling nights with few people returning", () => {
    const result = decide(signals({ trend: -4, declines: 2, returnRate: 0.1, attendance: [20, 18, 12] }));
    expect(result.decision).toBe("switch");
    expect(result.reasons[0]).toContain("10%");
  });

  it("does not switch while people keep coming back, even if attendance fell", () => {
    expect(decide(signals({ trend: -4, declines: 2, returnRate: 0.4 })).decision).toBe("tweak");
  });

  it("keeps after one night, and says it is too early", () => {
    const result = decide(signals({ sessions: 1, attendance: [9], trend: 0, returnRate: 0 }));
    expect(result.decision).toBe("keep");
    expect(result.reasons[0]).toContain("too early");
  });

  it("keeps a steady club with few returners but says what to do about it", () => {
    const result = decide(signals({ trend: 0, returnRate: 0.15, drift: 0.2 }));
    expect(result.decision).toBe("keep");
    expect(result.reasons[0]).toContain("15%");
  });
});

describe("buildSignals", () => {
  it("puts the pieces together from sessions, vectors and visit counts", () => {
    const sessions: SessionStats[] = [
      { number: 1, date: "2026-10-06", attendance: 9, checkedIn: 9, returning: 0, simulated: true, vibeRating: 4 },
      { number: 2, date: "2026-10-13", attendance: 13, checkedIn: 13, returning: 4, simulated: true, vibeRating: 4 },
      { number: 3, date: "2026-10-20", attendance: 16, checkedIn: 16, returning: 7, simulated: true, vibeRating: 5 },
      { number: 4, date: "2026-10-27", attendance: 21, checkedIn: 21, returning: 10, simulated: true, vibeRating: 5 },
    ];
    const v = toVector([{ name: "Anime", affinity: 1 }]);
    const result = buildSignals({ sessions, room: v, club: v, visitsPerPerson: new Map([["a", 4], ["b", 3], ["c", 1]]) });
    expect(result).toEqual({ sessions: 4, attendance: [9, 13, 16, 21], trend: 4, declines: 0, returnRate: 0.476, drift: 0, regularsMade: 2 });
    expect(decide(result).decision).toBe("keep");
  });
});

describe("buildWeeks", () => {
  const sess = (n: number, over: Partial<RawSession> = {}): RawSession => ({ id: `s${n}`, number: n, date: `2026-10-${String(n * 7).padStart(2, "0")}`, status: "closed", simulated: false, headcountManual: null, vibeRating: null, ...over });
  const ci = (session: number, person: string, tableNo: number | null = 1, favs: string[] = []): RawCheckin => ({
    sessionId: `s${session}`,
    attendeeId: person,
    tableNo,
    consent: true,
    vector: toVector([{ name: "Anime", affinity: 1 }]),
    favourites: favs.map((f) => ({ id: f, name: f.toUpperCase() })),
  });

  const checkins = [
    ci(1, "a"), ci(1, "b"), ci(1, "c"),
    ci(2, "a"), ci(2, "b"), ci(2, "d"), ci(2, "e"),
    ci(3, "a", 1, ["x", "y"]), ci(3, "d", 1, ["x"]), ci(3, "f", 2, ["x", "z"]), ci(3, "g", 2, ["y"]),
  ];
  const weeks = buildWeeks({ sessions: [sess(3), sess(1), sess(2), sess(4, { status: "open" })], checkins, baseline: 6 });

  it("lists nights with check-ins in order and skips the empty upcoming night", () => {
    expect(weeks.sessions.map((s) => [s.number, s.checkedIn, s.returning])).toEqual([[1, 3, 0], [2, 4, 2], [3, 4, 2]]);
  });

  it("counts regulars, return rate, seats against baseline and strangers seated", () => {
    expect(weeks.tiles.regularsMade).toBe(1);
    expect(weeks.tiles.returnRate).toBe(0.5);
    expect(weeks.tiles.seatsFilled).toBe(4);
    expect(weeks.tiles.baseline).toBe(6);
    // Night 1 table: ab ac bc (3). Night 2 table: ab (met) ad ae bd be de (5). Night 3: ad (met) fg (1) => 9.
    expect(weeks.tiles.strangersSeated).toBe(9);
  });

  it("uses the host's headcount when it is higher than the check-ins", () => {
    const counted = buildWeeks({ sessions: [sess(1, { headcountManual: 12 })], checkins: [ci(1, "a")], baseline: null });
    expect(counted.sessions[0]).toMatchObject({ attendance: 12, checkedIn: 1 });
  });

  it("describes the latest night's room by what its people picked", () => {
    expect(weeks.roomFavourites.map((f) => [f.name, f.count])).toEqual([["X", 3], ["Y", 2], ["Z", 1]]);
    expect(weeks.roomVector[0]).toMatchObject({ key: "anime", weight: 1 });
    expect(weeks.latestSessionId).toBe("s3");
  });

  it("handles a club with no check-ins", () => {
    const empty = buildWeeks({ sessions: [sess(1, { status: "open" })], checkins: [], baseline: null });
    expect(empty.sessions).toEqual([]);
    expect(empty.latestSessionId).toBeNull();
    expect(empty.tiles).toMatchObject({ regularsMade: 0, returnRate: 0, seatsFilled: 0 });
  });

  it("flags simulated nights", () => {
    expect(weeks.anySimulated).toBe(false);
    expect(buildWeeks({ sessions: [sess(1, { simulated: true })], checkins: [ci(1, "a")], baseline: null }).anySimulated).toBe(true);
  });
});
