import { describe, expect, it } from "vitest";
import { DEMO_NAMES, nicknameFor, pickFavouriteIds, planNights, seededRandom } from "@/src/demo/plan";

describe("the demo history", () => {
  const nights = planNights();

  it("has four nights of 9, 13, 16 and 21 check-ins", () => {
    expect(nights.map((n) => n.length)).toEqual([9, 13, 16, 21]);
  });

  it("has 0, 4, 7 and 10 people who had been before, and they really had", () => {
    const seen = new Set<string>();
    const returning = nights.map((night) => {
      const back = night.filter((p) => seen.has(p)).length;
      night.forEach((p) => seen.add(p));
      return back;
    });
    expect(returning).toEqual([0, 4, 7, 10]);
  });

  it("never lists a person twice on one night, and makes several regulars", () => {
    for (const night of nights) expect(new Set(night).size).toBe(night.length);
    const visits = new Map<string, number>();
    for (const night of nights) for (const p of night) visits.set(p, (visits.get(p) ?? 0) + 1);
    expect([...visits.values()].filter((v) => v >= 3).length).toBe(7);
  });

  it("gives every person a first name", () => {
    const everyone = new Set(nights.flat());
    for (const id of everyone) expect(DEMO_NAMES).toContain(nicknameFor(id));
    expect(everyone.size).toBeLessThanOrEqual(DEMO_NAMES.length);
  });
});

describe("favourites for simulated people", () => {
  const groups = [["a1", "a2", "a3", "a4"], ["b1", "b2", "b3"], ["c1", "c2", "c3", "c4", "c5"]];

  it("picks three different ids from the pool, the same way every time", () => {
    for (let n = 1; n <= 38; n++) {
      const picks = pickFavouriteIds(groups, `p${n}`);
      expect(picks).toHaveLength(3);
      expect(new Set(picks).size).toBe(3);
      for (const id of picks) expect(groups.flat()).toContain(id);
      expect(pickFavouriteIds(groups, `p${n}`)).toEqual(picks);
    }
  });

  it("gives people in the same group mostly the same tastes", () => {
    const own = pickFavouriteIds(groups, "p1");
    expect(own.filter((id) => id.startsWith("a")).length).toBeGreaterThanOrEqual(2);
  });

  it("copes with a tiny pool and with nothing at all", () => {
    expect(pickFavouriteIds([["x", "y", "z"]], "p1").sort()).toEqual(["x", "y", "z"]);
    expect(pickFavouriteIds([], "p1")).toEqual([]);
    expect(pickFavouriteIds([[], []], "p1")).toEqual([]);
  });

  it("has a repeatable random sequence", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
