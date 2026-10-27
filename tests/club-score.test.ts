import { describe, expect, it } from "vitest";
import { CLUB_FORMATS } from "@/src/agent/designer/candidates";
import {
  AREA_SCAN_SIZE,
  COMPONENTS,
  coherenceComponent,
  DEFAULT_COHERENCE,
  FORMAT_FIT,
  formatFitComponent,
  formatFitValue,
  cityCultureComponent,
  momentumComponent,
  percentileRank,
  rankScored,
  scoreClub,
  sweetSpot,
  sweetSpotComponent,
  WEIGHTS,
  type Breakdown,
  type Component,
} from "@/src/scoring/clubScore";

const c = (value: number): Component => ({ value, reason: "r", callIds: [] });
const breakdown = (v: Record<string, number>): Breakdown =>
  Object.fromEntries(COMPONENTS.map((name) => [name, c(v[name] ?? 0)])) as Breakdown;

describe("weights", () => {
  it("add up to exactly 1, with the spec's values", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(WEIGHTS).toEqual({ cityCulture: 0.15, venueCrowd: 0.2, nearbyPlaces: 0.15, coherence: 0.15, momentum: 0.1, sweetSpot: 0.1, formatFit: 0.15 });
    // The two parts that read this venue and its surroundings outweigh the city-wide part.
    expect(WEIGHTS.venueCrowd + WEIGHTS.nearbyPlaces).toBeGreaterThan(WEIGHTS.cityCulture);
  });
});

describe("scoreClub", () => {
  it("gives 100 for a perfect club and 0 for an empty one", () => {
    expect(scoreClub(breakdown({ cityCulture: 1, venueCrowd: 1, nearbyPlaces: 1, coherence: 1, momentum: 1, sweetSpot: 1, formatFit: 1 })).score).toBe(100);
    expect(scoreClub(breakdown({})).score).toBe(0);
  });

  it("gives known inputs a known score", () => {
    const { score } = scoreClub(breakdown({ cityCulture: 0.8, venueCrowd: 0.5, nearbyPlaces: 1, coherence: 0.5, momentum: 0.6, sweetSpot: 0.9, formatFit: 0.7 }));
    // 100 * (0.15 * 0.8 + 0.20 * 0.5 + 0.15 * 1 + 0.15 * 0.5 + 0.10 * 0.6 + 0.10 * 0.9 + 0.15 * 0.7)
    expect(score).toBe(70);
  });

  it("weights the venue's crowd more than the city's culture", () => {
    const crowd = scoreClub(breakdown({ venueCrowd: 1 })).score;
    const city = scoreClub(breakdown({ cityCulture: 1 })).score;
    expect(crowd).toBe(20);
    expect(city).toBe(15);
  });

  it("keeps out-of-range values inside 0 to 1 and does not change its input", () => {
    const input = breakdown({ cityCulture: 2, coherence: -1 });
    expect(scoreClub(input).score).toBe(15);
    expect(input.cityCulture.value).toBe(2);
  });

  it("is deterministic", () => {
    const b = breakdown({ cityCulture: 0.123, coherence: 0.456, nearbyPlaces: 0.789, momentum: 0.3, sweetSpot: 0.2, formatFit: 0.9 });
    expect(scoreClub(b).score).toBe(scoreClub(b).score);
  });
});

describe("sweetSpot", () => {
  it("peaks at the 60th percentile", () => {
    expect(sweetSpot(0.6)).toBe(1);
    for (const r of [0, 0.2, 0.4, 0.5, 0.7, 0.8, 1]) expect(sweetSpot(r)).toBeLessThan(sweetSpot(0.6));
  });

  it("falls off equally on both sides of the peak", () => {
    expect(sweetSpot(0.4)).toBeCloseTo(sweetSpot(0.8), 10);
    expect(sweetSpot(0.3)).toBeCloseTo(sweetSpot(0.9), 10);
  });

  it("is very low for the least and most popular", () => {
    expect(sweetSpot(0)).toBeCloseTo(Math.exp(-4.5), 6);
    expect(sweetSpot(1)).toBeCloseTo(Math.exp(-2), 6);
  });

  it("builds a component from a popularity percentile and says where the best spot is", () => {
    const peak = sweetSpotComponent({ anchorName: "X", popularity: 0.5, percentile: 0.6 });
    expect(peak.value).toBe(1);
    expect(peak.reason).toContain("60th percentile");
    expect(sweetSpotComponent({ anchorName: "X", popularity: 0.99, percentile: 0.97 }).reason).toContain("a household name");
    expect(sweetSpotComponent({ anchorName: "X", popularity: 0.1, percentile: 0.1 }).reason).toContain("very niche");
  });

  it("is neutral and flagged when Qloo gives no popularity (tags)", () => {
    expect(sweetSpotComponent({ anchorName: "Drama", popularity: null, percentile: null })).toMatchObject({ value: 0.5, flagged: true });
  });
});

describe("percentileRank", () => {
  it("counts ties as half", () => {
    expect(percentileRank(3, [1, 2, 3, 4])).toBe(0.625);
    expect(percentileRank(1, [1, 2, 3, 4])).toBe(0.125);
    expect(percentileRank(5, [1, 2, 3, 4])).toBe(1);
  });

  it("is 0.5 for an empty pool", () => {
    expect(percentileRank(0.7, [])).toBe(0.5);
  });

  it("is not fooled by popularity bunching near 1", () => {
    const bunched = [0.97, 0.98, 0.985, 0.99, 0.995];
    expect(percentileRank(0.985, bunched)).toBe(0.5);
  });
});

describe("format fit", () => {
  it("has a value for every venue type and format", () => {
    for (const venueType of ["cafe", "bookstore", "bar", "brewery", "restaurant", "music_venue", "community_space"]) {
      for (const format of CLUB_FORMATS) {
        const v = FORMAT_FIT[venueType][format];
        expect(v).toBeGreaterThanOrEqual(0.4);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("matches the spec's table at its corners", () => {
    expect(formatFitValue("bookstore", "book_club")).toBe(1);
    expect(formatFitValue("bar", "trivia_night")).toBe(1);
    expect(formatFitValue("brewery", "game_night")).toBe(0.9);
    expect(formatFitValue("restaurant", "tasting")).toBe(1);
    expect(formatFitValue("music_venue", "listening_night")).toBe(1);
    expect(formatFitValue("music_venue", "book_club")).toBe(0.4);
  });

  it("treats an unknown venue type like a community space", () => {
    expect(formatFitValue("laundromat", "game_night")).toBe(formatFitValue("community_space", "game_night"));
  });

  it("explains itself", () => {
    expect(formatFitComponent({ venueType: "bar", format: "trivia_night", formatLabel: "Trivia night" }).reason).toBe(
      "A trivia night suits a bar at 100 out of 100.",
    );
  });
});

describe("momentum", () => {
  it("is 1 in the top 5 of the trend results, 0.6 in the top 15 and 0.3 otherwise", () => {
    const m = (trendRank: number | null) => momentumComponent({ anchorName: "X", trendRank, supported: true, callId: "c" });
    expect([0, 4].map((r) => m(r).value)).toEqual([1, 1]);
    expect([5, 14].map((r) => m(r).value)).toEqual([0.6, 0.6]);
    expect([15, 40, null].map((r) => m(r).value)).toEqual([0.3, 0.3, 0.3]);
  });

  it("is neutral, not a penalty, where Qloo has no trend data (books)", () => {
    expect(momentumComponent({ anchorName: "X", trendRank: null, supported: false, callId: null })).toMatchObject({ value: 0.5, flagged: true });
  });

  it("links the call that showed the trend", () => {
    expect(momentumComponent({ anchorName: "X", trendRank: 2, supported: true, callId: "call-9" }).callIds).toEqual(["call-9"]);
    expect(momentumComponent({ anchorName: "X", trendRank: 2, supported: true, callId: "call-9" }).reason).toBe("X is number 3 of what is rising in your city.");
  });
});

describe("local affinity", () => {
  const range = { min: 0.97, max: 1 };

  it("is 1 for the top of the scan at the top of the range", () => {
    expect(cityCultureComponent({ anchorName: "X", domainLabel: "film", rank: 0, affinity: 1, range, callId: "c1" })).toMatchObject({
      value: 1,
      callIds: ["c1"],
    });
  });

  it("blends the position in the scan with the rescaled affinity", () => {
    // rank 7 of 15: 1 - 7/14 = 0.5. affinity 0.985 is halfway up 0.97 to 1.
    const result = cityCultureComponent({ anchorName: "X", domainLabel: "film", rank: 7, affinity: 0.985, range, callId: null });
    expect(result.value).toBe(0.5);
    expect(result.reason).toBe("Number 8 of 15 in what your city loves in film (affinity 0.985, 50% of the way up its range).");
  });

  it("cannot be fooled by Qloo's saturated affinity: 0.9999 against 0.9998 is a difference of position, not of affinity", () => {
    const first = cityCultureComponent({ anchorName: "A", domainLabel: "film", rank: 0, affinity: 0.9999, range: { min: 0.9998, max: 0.9999 }, callId: null });
    const last = cityCultureComponent({ anchorName: "B", domainLabel: "film", rank: AREA_SCAN_SIZE - 1, affinity: 0.9998, range: { min: 0.9998, max: 0.9999 }, callId: null });
    expect(first.value).toBe(1);
    expect(last.value).toBe(0);
  });

  it("handles a list where every affinity is the same", () => {
    const only = cityCultureComponent({ anchorName: "X", domainLabel: "film", rank: 0, affinity: 1, range: { min: 1, max: 1 }, callId: null });
    expect(only.value).toBe(1);
  });

  it("is neutral and flagged when the anchor was not in the area scan", () => {
    expect(cityCultureComponent({ anchorName: "X", domainLabel: "film", rank: null, affinity: null, range: null, callId: null })).toMatchObject({
      value: 0.5,
      flagged: true,
      callIds: [],
    });
  });
});

describe("coherence", () => {
  it("is the mean affinity of the companions Qloo ranked for fans of the anchor", () => {
    const result = coherenceComponent({
      anchorName: "Spirited Away",
      companions: [
        { kind: "scored", name: "Nujabes", affinity: 0.9 },
        { kind: "scored", name: "Kitchen", affinity: 0.7 },
      ],
      callIds: ["c4"],
      verified: true,
    });
    expect(result.value).toBe(0.8);
    expect(result.callIds).toEqual(["c4"]);
    expect(result.reason).toBe("For fans of Spirited Away: Nujabes 0.90; Kitchen 0.70. Mean 0.80.");
    expect(result.flagged).toBeUndefined();
  });

  it("counts a companion Qloo did not rank as low, not as an error", () => {
    const result = coherenceComponent({
      anchorName: "A",
      companions: [
        { kind: "scored", name: "B", affinity: 0.9 },
        { kind: "scored", name: "C", affinity: null },
      ],
      callIds: [],
      verified: true,
    });
    expect(result.value).toBe(0.5);
    expect(result.reason).toContain("C not ranked by Qloo");
  });

  it("defaults to 0.3 and says so when the club was not checked", () => {
    const result = coherenceComponent({ anchorName: "A", companions: [{ kind: "scored", name: "B", affinity: null }], callIds: [], verified: false });
    expect(result).toMatchObject({ value: DEFAULT_COHERENCE, flagged: true });
    expect(result.reason).toContain("Not checked with Qloo");
  });

  it("leaves companions Qloo was never asked about out of the mean, instead of counting them as unranked", () => {
    const result = coherenceComponent({
      anchorName: "A",
      companions: [{ kind: "scored", name: "B", affinity: null }, { kind: "tag", name: "Comedy", carriedByAnchor: true }],
      callIds: [],
      verified: false,
    });
    expect(result.value).toBe(0.9);
    expect(result.flagged).toBe(true);
    expect(result.reason).toContain("The other companions were not checked with Qloo.");
    expect(result.reason).not.toContain("not ranked by Qloo");
  });

  it("defaults when the only companions are places", () => {
    const result = coherenceComponent({ anchorName: "A", companions: [{ kind: "place", name: "Ramen Bar" }], callIds: [], verified: true });
    expect(result).toMatchObject({ value: 0.3, flagged: true });
  });

  it("judges a tag companion by whether the anchor carries it, and leaves places out of the mean", () => {
    const carried = coherenceComponent({
      anchorName: "A",
      companions: [{ kind: "tag", name: "Drama", carriedByAnchor: true }, { kind: "place", name: "P" }],
      callIds: [],
      verified: false,
    });
    expect(carried.value).toBe(0.9);
    const notCarried = coherenceComponent({ anchorName: "A", companions: [{ kind: "tag", name: "Horror", carriedByAnchor: false }], callIds: [], verified: false });
    expect(notCarried.value).toBe(0.4);
    expect(notCarried.reason).toContain("Horror is not one of A's tags");
  });
});

describe("rankScored", () => {
  it("orders by score, highest first, and breaks ties by title", () => {
    const ranked = rankScored([
      { score: 70, title: "B" },
      { score: 80, title: "Z" },
      { score: 70, title: "A" },
    ]);
    expect(ranked.map((r) => r.title)).toEqual(["Z", "A", "B"]);
  });

  it("does not change the list it is given", () => {
    const input = [{ score: 1, title: "b" }, { score: 2, title: "a" }];
    rankScored(input);
    expect(input.map((r) => r.title)).toEqual(["b", "a"]);
  });
});
