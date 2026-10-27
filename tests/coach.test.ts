import { describe, expect, it } from "vitest";
import { COACH_SYSTEM, coachPrompt } from "@/src/agent/prompts/coach";
import { createCoach, quotesNumbers, standardVariant, type CoachClub, type CoachDeps, type Recommendation, type RecommendationSignals, type Variant } from "@/src/coach/coach";
import { buildWeeks, type RawCheckin, type RawSession } from "@/src/coach/weeks";
import { toVector } from "@/src/seating/tasteVector";

const GHIBLI = toVector([{ name: "Anime", affinity: 1 }, { name: "Studio Ghibli", affinity: 0.8 }]);

// The demo shape: 9, 13, 16, 21 check-ins, 0, 4, 7, 10 of them returning.
function demoWeeks(room = GHIBLI) {
  const sessions: RawSession[] = [1, 2, 3, 4].map((n) => ({ id: `s${n}`, number: n, date: `2026-10-0${n}`, status: "closed", simulated: true, headcountManual: null, vibeRating: 4 }));
  const plan: Array<{ session: number; total: number; returning: string[] }> = [
    { session: 1, total: 9, returning: [] },
    { session: 2, total: 13, returning: ["p1", "p2", "p3", "p4"] },
    { session: 3, total: 16, returning: ["p1", "p2", "p3", "p5", "p10", "p11", "p12"] },
    { session: 4, total: 21, returning: ["p1", "p2", "p3", "p4", "p10", "p11", "p13", "p19", "p20", "p5"] },
  ];
  const checkins: RawCheckin[] = [];
  // The first night is p1 to p9; everyone new after that gets the next number, so "returning" is true to the data.
  let fresh = 1;
  for (const step of plan) {
    const people = [...step.returning, ...Array.from({ length: step.total - step.returning.length }, () => `p${fresh++}`)];
    people.forEach((id, i) => checkins.push({ sessionId: `s${step.session}`, attendeeId: id, tableNo: (i % 4) + 1, consent: true, vector: room, favourites: [{ id: "fx_a", name: "Spirited Away" }] }));
  }
  return buildWeeks({ sessions, checkins, baseline: 6 });
}

const club = (over: Partial<CoachClub> = {}): CoachClub => ({
  clubId: "club-1",
  runId: "run-1",
  title: "Ghibli and Lo-fi Tuesdays",
  venueType: "cafe",
  slowNight: "tuesday",
  baseline: 6,
  weeks: demoWeeks(),
  themeEntityIds: ["fx_spirited_away"],
  themeDomain: "movie",
  venue: { lat: 40.7, lon: -73.9 },
  nextBestTitle: "Soul Sundays",
  existing: null,
  ...over,
});

function setup(c: CoachClub, answer?: (prompt: string) => Variant | null) {
  const saved: Array<Omit<Recommendation, "id">> = [];
  const prompts: string[] = [];
  const deps: CoachDeps = {
    load: async (id) => (id === "club-1" ? c : null),
    clubTaste: async () => GHIBLI,
    adjacentThemes: async () => ["My Neighbor Totoro", "Kiki's Delivery Service"],
    save: async (rec) => {
      saved.push(rec);
      return { ...rec, id: `rec-${saved.length}` };
    },
    generateStructured: (async (_schema: unknown, prompt: string, opts: { fallback: () => Variant; check?: (v: Variant) => void }) => {
      prompts.push(prompt);
      const out = answer?.(prompt);
      if (out) {
        try {
          opts.check?.(out);
          return { output: out, source: "llm" as const };
        } catch {
          // A rejected answer falls back, as the real layer does after its one retry.
        }
      }
      return { output: opts.fallback(), source: "fallback" as const };
    }) as never,
  };
  return { recommend: createCoach(deps), saved, prompts };
}

const goodAnswer: Variant = {
  variantTitle: "Totoro and Tea Tuesdays",
  hook: "Same club, now with a Totoro warm-up round.",
  runOfShowChange: "Open with a ten minute Totoro round before the main discussion.",
  rationale: "Check-ins grew from 16 to 21 and 48% of last night had been before, so keep the club and add a fresh Totoro round.",
};

describe("the Coach on the demo numbers", () => {
  it("recommends keeping the club, with a fresh sub-theme and a rationale that quotes the return rate", async () => {
    const { recommend, saved } = setup(club(), () => goodAnswer);
    const result = await recommend("club-1");
    expect(result?.created).toBe(true);
    const rec = saved[0];
    expect(rec.decision).toBe("keep");
    expect(rec.rationale).toContain("48%");
    expect(rec.proposal.variantTitle).toBe("Totoro and Tea Tuesdays");
    expect(rec.afterSessionId).toBe("s4");
    expect(rec.status).toBe("proposed");
    expect(rec.signals).toMatchObject({ attendance: [9, 13, 16, 21], trend: 4, regularsMade: 7, drift: 0, adjacent: ["My Neighbor Totoro", "Kiki's Delivery Service"] });
  });

  it("writes a plain version with the same numbers when no model answers", async () => {
    const { recommend, saved } = setup(club());
    await recommend("club-1");
    const rec = saved[0];
    expect(rec.source).toBe("fallback");
    expect(rec.decision).toBe("keep");
    expect(rec.rationale).toContain("9, 13, 16, 21");
    expect(rec.rationale).toContain("48%");
    expect(rec.proposal.variantTitle).toContain("My Neighbor Totoro");
  });

  it("replaces a model rationale that quotes no numbers, so the owner always sees figures", async () => {
    const vague: Variant = { ...goodAnswer, rationale: "The club is doing nicely and people seem to enjoy it, so we should keep going." };
    const { recommend, saved } = setup(club(), () => vague);
    await recommend("club-1");
    expect(saved[0].rationale).toContain("48%");
  });

  it("returns the same recommendation for the same night without asking again", async () => {
    const first = setup(club());
    await first.recommend("club-1");
    const existing: Recommendation = { ...first.saved[0], id: "rec-1" };
    const again = setup(club({ existing }));
    const result = await again.recommend("club-1");
    expect(result).toMatchObject({ created: false });
    expect(again.prompts).toEqual([]);
    expect(again.saved).toEqual([]);
    const forced = await again.recommend("club-1", { force: true });
    expect(forced?.created).toBe(true);
  });

  it("asks again after a newer night", async () => {
    const first = setup(club());
    await first.recommend("club-1");
    const old: Recommendation = { ...first.saved[0], id: "rec-1", afterSessionId: "s3" };
    const next = setup(club({ existing: old }));
    expect((await next.recommend("club-1"))?.created).toBe(true);
  });
});

describe("the Coach in trouble", () => {
  it("tweaks toward the room when the room's taste has drifted from the club's theme", async () => {
    const metal = toVector([{ name: "Metal", affinity: 1 }, { name: "Punk", affinity: 0.8 }]);
    const weeks = demoWeeks(metal);
    // Make attendance flat and returners few so the keep rule does not apply.
    const flat = buildWeeks({
      sessions: [1, 2, 3].map((n) => ({ id: `s${n}`, number: n, date: `2026-10-0${n}`, status: "closed" as const, simulated: false, headcountManual: null, vibeRating: null })),
      checkins: [1, 2, 3].flatMap((n) => Array.from({ length: 10 }, (_, i) => ({ sessionId: `s${n}`, attendeeId: `${n}-${i}`, tableNo: 1, consent: true, vector: metal, favourites: [{ id: "fx_m", name: "Metallica" }] }))),
      baseline: null,
    });
    expect(weeks.roomVector[0].key).toBe("metal");
    const { recommend, saved, prompts } = setup(club({ weeks: flat }));
    await recommend("club-1");
    expect(saved[0].decision).toBe("tweak");
    expect(saved[0].signals.drift).toBe(1);
    expect(prompts[0]).toContain("Metal");
  });

  it("still works when Qloo has no theme tags: drift is not measured, and the page can say so", async () => {
    const { recommend, saved } = setup(club({ themeEntityIds: [], themeDomain: null }));
    await recommend("club-1");
    expect(saved[0].signals).toMatchObject({ driftMissing: true, drift: 0, adjacent: [] });
  });

  it("returns nothing for a club that does not exist or has no nights yet", async () => {
    expect(await setup(club()).recommend("nope")).toBeNull();
    const empty = buildWeeks({ sessions: [], checkins: [], baseline: null });
    expect(await setup(club({ weeks: empty })).recommend("club-1")).toBeNull();
  });
});

describe("what the model is told", () => {
  it("is numbers and tag names for the room, never a person", async () => {
    const { recommend, prompts } = setup(club());
    await recommend("club-1");
    expect(prompts[0]).toContain("Decision already made: KEEP");
    expect(prompts[0]).toContain("48%");
    expect(prompts[0]).toContain("9, 13, 16, 21");
    expect(COACH_SYSTEM).toMatch(/Do not change it/);
    expect(prompts[0]).not.toMatch(/p1\b|n10\d/);
  });

  it("mentions the next best idea only for a switch", () => {
    const base = { decision: "keep" as const, reasons: ["r"], clubTitle: "C", venueType: "cafe", night: null, attendance: [3, 2], trend: -1, returnRate: 0.1, regularsMade: 0, drift: 0.2, roomTags: [], clubTags: [], adjacent: [], roomFavourites: [], nextBest: "Soul Sundays" };
    expect(coachPrompt(base)).not.toContain("Soul Sundays");
    expect(coachPrompt({ ...base, decision: "switch" })).toContain("Soul Sundays");
  });
});

describe("quotesNumbers and the plain version", () => {
  const s = { returnRate: 0.476, attendance: [9, 13, 16, 21], regularsMade: 6 };

  it("accepts the return rate or the last night's check-ins, and nothing vague", () => {
    expect(quotesNumbers("48% came back.", s)).toBe(true);
    expect(quotesNumbers("21 people came.", s)).toBe(true);
    expect(quotesNumbers("Doing fine.", s)).toBe(false);
    expect(quotesNumbers("Room for 210 people.", s)).toBe(false);
  });

  it("has a plain variant for every decision, without dashes", () => {
    const signals: RecommendationSignals = { sessions: 4, attendance: [9, 13, 16, 21], trend: 4, declines: 0, returnRate: 0.476, drift: 0.2, regularsMade: 6, roomTags: ["anime"], clubTags: [], adjacent: [], roomFavourites: [], driftMissing: true };
    for (const decision of ["keep", "tweak", "switch"] as const) {
      const v = standardVariant(decision, ["Because."], signals, "Club");
      expect(v.variantTitle.length).toBeGreaterThan(1);
      expect(v.rationale).toContain("48%");
      expect(JSON.stringify(v)).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
    }
  });
});
