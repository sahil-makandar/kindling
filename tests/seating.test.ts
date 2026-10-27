import { describe, expect, it } from "vitest";
import { assignTables, explainTable, placeAttendee, type Seating } from "@/src/seating/assignTables";
import { cosine, similarity, sharedFavourites, sumVectors, toVector, weightedJaccard, type Person } from "@/src/seating/tasteVector";

const tags = (...pairs: Array<[string, number]>) => toVector(pairs.map(([name, affinity]) => ({ name, affinity })));

const GHIBLI = tags(["Anime", 1], ["Studio Ghibli", 0.9], ["Fantasy", 0.7], ["Lo-fi", 0.5]);
const SOUL = tags(["Soul", 1], ["Jazz", 0.8], ["Motown", 0.7], ["Natural wine", 0.4]);
const NOIR = tags(["Thriller", 1], ["Noir", 0.9], ["True crime", 0.6], ["Mystery", 0.5]);

const person = (id: string, vector = GHIBLI, favourites: Array<[string, string]> = [], regular = false): Person => ({
  id,
  vector,
  regular,
  favourites: favourites.map(([fid, name]) => ({ id: fid, name })),
});

describe("toVector", () => {
  it("scales to the strongest tag, sorts, dedupes by name and ignores case", () => {
    const v = toVector([
      { name: "Comedy", affinity: 0.4 },
      { name: "comedy", affinity: 0.8 },
      { name: "Drama", affinity: 0.2 },
    ]);
    expect(v.map((t) => [t.key, t.weight])).toEqual([["comedy", 1], ["drama", 0.25]]);
    expect(v[0].name).toBe("comedy");
  });

  it("counts tags with no weight as equal and caps the length", () => {
    expect(toVector([{ name: "A" }, { name: "B" }]).map((t) => t.weight)).toEqual([1, 1]);
    expect(toVector(Array.from({ length: 40 }, (_, i) => ({ name: `T${i}`, affinity: 1 })), 25)).toHaveLength(25);
    expect(toVector([])).toEqual([]);
  });
});

describe("similarity", () => {
  it("is 1 for identical tags, 0 for none in common, and ignores empty vectors", () => {
    expect(weightedJaccard(GHIBLI, GHIBLI)).toBe(1);
    expect(weightedJaccard(GHIBLI, SOUL)).toBe(0);
    expect(weightedJaccard([], GHIBLI)).toBe(0);
  });

  it("mixes tag overlap (75%) with a shared favourite (25%)", () => {
    const a = person("a", GHIBLI, [["fx_1", "Spirited Away"]]);
    const b = person("b", SOUL, [["fx_1", "Spirited Away"]]);
    expect(similarity(a, b)).toBeCloseTo(0.25);
    expect(similarity(person("a"), person("b"))).toBeCloseTo(0.75);
    expect(sharedFavourites(a.favourites, b.favourites)).toEqual([{ id: "fx_1", name: "Spirited Away" }]);
  });

  it("has a cosine for the Coach and a room vector that adds people up", () => {
    expect(cosine(GHIBLI, GHIBLI)).toBeCloseTo(1);
    expect(cosine(GHIBLI, SOUL)).toBe(0);
    const room = sumVectors([GHIBLI, GHIBLI, SOUL]);
    expect(room[0].key).toBe("anime");
    expect(room[0].weight).toBe(1);
  });
});

describe("assignTables", () => {
  const twelve: Person[] = [
    ...["g1", "g2", "g3", "g4"].map((id) => person(id, GHIBLI)),
    ...["s1", "s2", "s3", "s4"].map((id) => person(id, SOUL)),
    ...["n1", "n2", "n3", "n4"].map((id) => person(id, NOIR)),
  ];
  // Mixed arrival order, so the answer cannot depend on it.
  const shuffled = [3, 8, 0, 11, 5, 2, 9, 6, 1, 10, 4, 7].map((i) => twelve[i]);

  it("seats 12 people with three clear tastes at three tables of their own taste", () => {
    const { tables } = assignTables(shuffled);
    expect(tables).toHaveLength(3);
    for (const table of tables) {
      expect(table.memberIds).toHaveLength(4);
      expect(new Set(table.memberIds.map((id) => id[0])).size).toBe(1);
      expect(table.explanation.everyoneShares).toBe(true);
    }
  });

  it("clusters identical people together", () => {
    const people = [person("a1"), person("a2"), person("b1", SOUL), person("b2", SOUL)];
    const { tables } = assignTables(people, { tableSize: 3 });
    const withA1 = tables.find((t) => t.memberIds.includes("a1"));
    expect(withA1?.memberIds).toContain("a2");
    expect(withA1?.memberIds).not.toContain("b1");
  });

  it("never leaves anyone alone when there are two or more people", () => {
    for (let n = 2; n <= 30; n++) {
      const people = Array.from({ length: n }, (_, i) => person(`p${String(i).padStart(2, "0")}`, [GHIBLI, SOUL, NOIR][i % 3]));
      for (const tableSize of [3, 4, 5, 6]) {
        const { tables } = assignTables(people, { tableSize });
        expect(tables.reduce((sum, t) => sum + t.memberIds.length, 0)).toBe(n);
        for (const table of tables) expect(table.memberIds.length, `n=${n} size=${tableSize}`).toBeGreaterThanOrEqual(2);
        for (const table of tables) expect(table.memberIds.length).toBeLessThanOrEqual(tableSize);
      }
    }
  });

  it("seats everyone exactly once", () => {
    const { tables } = assignTables(shuffled);
    const seated = tables.flatMap((t) => t.memberIds).sort();
    expect(seated).toEqual(twelve.map((p) => p.id).sort());
  });

  it("is deterministic: the same people in any order give the same tables", () => {
    const first = assignTables(shuffled);
    const second = assignTables([...shuffled].reverse());
    expect(second).toEqual(first);
    expect(assignTables(shuffled)).toEqual(first);
  });

  it("spreads regulars so newcomers meet them", () => {
    const people = [
      ...["r1", "r2", "r3", "r4"].map((id) => person(id, GHIBLI, [], true)),
      ...["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"].map((id) => person(id, GHIBLI)),
    ];
    const { tables } = assignTables(people);
    expect(tables).toHaveLength(3);
    for (const table of tables) {
      const regulars = table.memberIds.filter((id) => id.startsWith("r")).length;
      expect(regulars).toBeLessThanOrEqual(Math.ceil(4 / 3) + 1);
    }
  });

  it("handles no people, one person, and people with no taste data", () => {
    expect(assignTables([])).toEqual({ tables: [], waiting: [] });
    expect(assignTables([person("only")]).tables).toHaveLength(1);
    const blank = assignTables([person("a", []), person("b", []), person("c", [])]);
    expect(blank.tables).toHaveLength(1);
    expect(blank.tables[0].explanation.sharedTags).toEqual([]);
  });
});

describe("explainTable", () => {
  it("lists the most shared tags first, with any shared favourites", () => {
    const members = [
      person("a", GHIBLI, [["fx_1", "Spirited Away"], ["fx_2", "Nujabes"]]),
      person("b", GHIBLI, [["fx_1", "Spirited Away"]]),
      person("c", tags(["Anime", 1], ["Fantasy", 0.5]), []),
    ];
    const explanation = explainTable(members);
    expect(explanation.sharedTags.map((t) => t.name).slice(0, 3)).toEqual(["Anime", "Fantasy", "Studio Ghibli"]);
    expect(explanation.sharedTags[0].count).toBe(3);
    expect(explanation.sharedFavourites).toEqual([{ name: "Spirited Away", count: 2 }]);
    expect(explanation.everyoneShares).toBe(true);
  });

  it("says nobody shares everything when the top tag is not held by all", () => {
    const explanation = explainTable([person("a", GHIBLI), person("b", GHIBLI), person("c", SOUL)]);
    expect(explanation.everyoneShares).toBe(false);
    expect(explanation.sharedTags[0].count).toBe(2);
  });
});

describe("placeAttendee", () => {
  function seatAll(people: Person[]): { seating: Seating; all: Person[] } {
    let seating: Seating = { tables: [], waiting: [] };
    const seen: Person[] = [];
    for (const p of people) {
      seating = placeAttendee(seen, seating, p).seating;
      seen.push(p);
    }
    return { seating, all: seen };
  }

  it("puts a latecomer at the table that shares their taste", () => {
    const people = [person("a1"), person("a2"), person("a3"), person("s1", SOUL), person("s2", SOUL)];
    const { seating, all } = seatAll(people);
    const late = person("a4");
    const { seating: after, placement } = placeAttendee(all, seating, late);
    const table = after.tables.find((t) => t.memberIds.includes("a4"));
    expect(placement.waiting).toBe(false);
    expect(table?.memberIds).toEqual(expect.arrayContaining(["a1", "a2", "a3"]));
    expect(placement.table).toBe(table?.number);
  });

  it("gives a person alone company before opening another table", () => {
    const first = placeAttendee([], { tables: [], waiting: [] }, person("a"));
    expect(first.placement.table).toBe(1);
    const second = placeAttendee([person("a")], first.seating, person("z", NOIR));
    expect(second.seating.tables).toHaveLength(1);
    expect(second.seating.tables[0].memberIds).toEqual(["a", "z"]);
  });

  it("opens a new table when nobody fits well and nobody is alone", () => {
    const { seating, all } = seatAll([person("a1"), person("a2")]);
    const { seating: after, placement } = placeAttendee(all, seating, person("n1", NOIR));
    expect(after.tables).toHaveLength(2);
    expect(placement.table).toBe(2);
  });

  it("makes people wait when every table is full, and seats two waiting people together", () => {
    const { seating, all } = seatAll(["a1", "a2", "a3", "a4"].map((id) => person(id)));
    expect(seating.tables).toHaveLength(1);
    const one = placeAttendee(all, seating, person("a5"), { tableSize: 4 });
    expect(one.placement).toEqual({ table: null, waiting: true });
    expect(one.seating.waiting).toEqual(["a5"]);
    const two = placeAttendee([...all, person("a5")], one.seating, person("a6"), { tableSize: 4 });
    expect(two.placement).toEqual({ table: 2, waiting: false });
    expect(two.seating.waiting).toEqual([]);
    expect(two.seating.tables[1].memberIds).toEqual(["a5", "a6"]);
  });

  it("does not seat the same person twice", () => {
    const { seating, all } = seatAll([person("a1"), person("a2")]);
    const again = placeAttendee(all, seating, person("a1"));
    expect(again.seating).toEqual(seating);
    expect(again.placement.table).toBe(1);
  });

  it("is deterministic for the same arrivals", () => {
    const people = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => person(id, [GHIBLI, SOUL, NOIR][i % 3]));
    expect(seatAll(people).seating).toEqual(seatAll(people).seating);
  });
});
