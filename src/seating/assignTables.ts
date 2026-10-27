import { similarity, type Person } from "./tasteVector";

// Seating (PRODUCT_SPEC 5.5). Pure and deterministic: the same people give the same tables, with ties broken by id.

export const MIN_TABLE_SIZE = 3;
export const MAX_TABLE_SIZE = 6;
export const DEFAULT_TABLE_SIZE = 4;
const MAX_SWAPS = 200;
// A newcomer who matches nobody well opens a new table instead of joining a poor fit.
const NEW_TABLE_BELOW = 0.1;
const LONELY_BONUS = 0.15;
const MAX_TABLES = 12;

export type SharedItem = { name: string; count: number };

export type TableExplanation = {
  // Tags held by at least two members, most shared first, then strongest.
  sharedTags: SharedItem[];
  // Favourites that at least two members picked.
  sharedFavourites: SharedItem[];
  // True when every member holds the top shared tag.
  everyoneShares: boolean;
  // How many people the counts are out of.
  size: number;
};

export type Table = { number: number; memberIds: string[]; explanation: TableExplanation };
export type Seating = { tables: Table[]; waiting: string[] };

export type SeatingOptions = { tableSize?: number };

const clampSize = (size: number | undefined): number => Math.min(MAX_TABLE_SIZE, Math.max(MIN_TABLE_SIZE, Math.round(size ?? DEFAULT_TABLE_SIZE)));
const byId = (a: Person, b: Person) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- explaining a table ----

export function explainTable(members: readonly Person[]): TableExplanation {
  const tags = new Map<string, { name: string; count: number; weight: number }>();
  const favourites = new Map<string, { name: string; count: number }>();
  for (const member of members) {
    for (const tag of member.vector) {
      const known = tags.get(tag.key);
      tags.set(tag.key, { name: known?.name ?? tag.name, count: (known?.count ?? 0) + 1, weight: (known?.weight ?? 0) + tag.weight });
    }
    for (const fav of new Map(member.favourites.map((f) => [f.id, f])).values()) {
      const known = favourites.get(fav.id);
      favourites.set(fav.id, { name: known?.name ?? fav.name, count: (known?.count ?? 0) + 1 });
    }
  }
  const shared = [...tags.values()].filter((t) => t.count >= 2).sort((a, b) => b.count - a.count || b.weight - a.weight || a.name.localeCompare(b.name));
  const sharedFavourites = [...favourites.values()].filter((f) => f.count >= 2).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    sharedTags: shared.slice(0, 6).map(({ name, count }) => ({ name, count })),
    sharedFavourites: sharedFavourites.slice(0, 6),
    everyoneShares: members.length >= 2 && shared.length > 0 && shared[0].count === members.length,
    size: members.length,
  };
}

function toTables(groups: Person[][], people: ReadonlyMap<string, Person>): Table[] {
  return groups
    .filter((g) => g.length > 0)
    .map((group, index) => ({
      number: index + 1,
      memberIds: group.map((p) => p.id).sort(),
      explanation: explainTable(group.map((p) => people.get(p.id) ?? p)),
    }));
}

// ---- seating everyone at once ----

export function assignTables(input: readonly Person[], options: SeatingOptions = {}): Seating {
  const people = [...input].sort(byId);
  const n = people.length;
  if (n === 0) return { tables: [], waiting: [] };

  const size = clampSize(options.tableSize);
  const tableCount = Math.max(1, Math.ceil(n / size));
  const capacity = Math.ceil(n / tableCount);
  const floor = Math.floor(n / tableCount);
  const regulars = people.filter((p) => p.regular).length;
  const regularsMax = Math.ceil(regulars / tableCount) + 1;

  const sim: number[][] = people.map((a) => people.map((b) => (a === b ? 1 : similarity(a, b))));
  const groups: number[][] = Array.from({ length: tableCount }, () => []);
  const placed = new Set<number>();
  const regularsAt = (g: number[]) => g.filter((i) => people[i].regular).length;

  // 2. Seeds: farthest first, so tables start with different flavours.
  const seeds: number[] = [0];
  while (seeds.length < Math.min(tableCount, n)) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < n; i++) {
      if (seeds.includes(i)) continue;
      const closest = Math.max(...seeds.map((s) => sim[i][s]));
      if (closest < bestScore - 1e-12) {
        bestScore = closest;
        best = i;
      }
    }
    seeds.push(best);
  }
  seeds.forEach((seed, g) => {
    groups[g].push(seed);
    placed.add(seed);
  });

  // 3. Everyone else, hardest to place first, into the table with room that suits them best.
  const rest = people
    .map((_, i) => i)
    .filter((i) => !placed.has(i))
    .map((i) => ({ i, closest: Math.max(...seeds.map((s) => sim[i][s])) }))
    .sort((a, b) => a.closest - b.closest || a.i - b.i);
  for (const { i } of rest) {
    let bestGroup = -1;
    let bestMean = -1;
    for (let g = 0; g < groups.length; g++) {
      if (groups[g].length >= capacity) continue;
      if (people[i].regular && regularsAt(groups[g]) >= regularsMax) continue;
      const mean = groups[g].reduce((sum, j) => sum + sim[i][j], 0) / groups[g].length;
      if (mean > bestMean + 1e-12) {
        bestMean = mean;
        bestGroup = g;
      }
    }
    // The regulars cap can leave no legal table; then it yields, because a seat matters more than the spread.
    if (bestGroup === -1) bestGroup = groups.findIndex((g) => g.length < capacity);
    groups[bestGroup].push(i);
  }

  // 4. Swap people between tables while it makes the tables more alike inside.
  const closeness = (person: number, group: number[], skip: number) =>
    group.reduce((sum, j) => (j === skip ? sum : sum + sim[person][j]), 0);
  for (let swaps = 0; swaps < MAX_SWAPS; swaps++) {
    let best: { ga: number; ia: number; gb: number; ib: number; gain: number } | null = null;
    for (let ga = 0; ga < groups.length; ga++) {
      for (let gb = ga + 1; gb < groups.length; gb++) {
        for (let ia = 0; ia < groups[ga].length; ia++) {
          for (let ib = 0; ib < groups[gb].length; ib++) {
            const a = groups[ga][ia];
            const b = groups[gb][ib];
            const before = closeness(a, groups[ga], a) + closeness(b, groups[gb], b);
            const after = closeness(a, groups[gb], b) + closeness(b, groups[ga], a);
            const gain = after - before;
            if (gain <= 1e-9 || (best && gain <= best.gain + 1e-12)) continue;
            // Do not break the regulars spread.
            const regA = regularsAt(groups[ga]) - (people[a].regular ? 1 : 0) + (people[b].regular ? 1 : 0);
            const regB = regularsAt(groups[gb]) - (people[b].regular ? 1 : 0) + (people[a].regular ? 1 : 0);
            if (regA > regularsMax || regB > regularsMax) continue;
            best = { ga, ia, gb, ib, gain };
          }
        }
      }
    }
    if (!best) break;
    const a = groups[best.ga][best.ia];
    groups[best.ga][best.ia] = groups[best.gb][best.ib];
    groups[best.gb][best.ib] = a;
  }

  // 5. Nobody sits alone: top up any table that is below the floor from the fullest table, taking the person who fits
  // the small table best and is missed least.
  if (n >= 2) {
    for (let guard = 0; guard < n; guard++) {
      const small = groups.findIndex((g) => g.length > 0 && g.length < Math.max(2, floor));
      if (small === -1) break;
      let donor = -1;
      for (let g = 0; g < groups.length; g++) if (g !== small && groups[g].length > groups[small].length + 1 && (donor === -1 || groups[g].length > groups[donor].length)) donor = g;
      if (donor === -1) break;
      let pick = -1;
      let pickScore = -Infinity;
      for (const candidate of groups[donor]) {
        const score = closeness(candidate, groups[small], candidate) / groups[small].length - closeness(candidate, groups[donor], candidate) / (groups[donor].length - 1);
        if (score > pickScore + 1e-12) {
          pickScore = score;
          pick = candidate;
        }
      }
      groups[donor] = groups[donor].filter((i) => i !== pick);
      groups[small].push(pick);
    }
  }

  const lookup = new Map(people.map((p) => [p.id, p]));
  // Stable table numbers: the table holding the lowest id is table 1.
  const lowest = (group: Person[]) => group.map((p) => p.id).sort()[0];
  const named = groups
    .map((g) => g.map((i) => people[i]))
    .filter((g) => g.length > 0)
    .sort((a, b) => (lowest(a) < lowest(b) ? -1 : 1));
  return { tables: toTables(named, lookup), waiting: [] };
}

// ---- seating one more person ----

export type Placement = { table: number | null; waiting: boolean };

// Seats a latecomer at the table with room where they fit best. A table of one is favoured so nobody is left alone.
// When every table is full they wait, and two people waiting open a new table together.
export function placeAttendee(
  all: readonly Person[],
  seating: Seating,
  newcomer: Person,
  options: SeatingOptions = {},
): { seating: Seating; placement: Placement } {
  const capacity = clampSize(options.tableSize);
  const people = new Map([...all, newcomer].map((p) => [p.id, p]));
  const groups: Person[][] = seating.tables.map((t) => t.memberIds.map((id) => people.get(id)).filter((p): p is Person => p !== undefined));
  const waiting = seating.waiting.map((id) => people.get(id)).filter((p): p is Person => p !== undefined);

  if (groups.some((g) => g.some((p) => p.id === newcomer.id)) || waiting.some((p) => p.id === newcomer.id)) {
    const table = seating.tables.find((t) => t.memberIds.includes(newcomer.id));
    return { seating, placement: { table: table?.number ?? null, waiting: !table } };
  }

  let target = -1;
  let targetScore = -Infinity;
  let targetMean = 0;
  groups.forEach((group, g) => {
    if (group.length >= capacity) return;
    const mean = group.reduce((sum, p) => sum + similarity(newcomer, p), 0) / Math.max(1, group.length);
    const score = mean + (group.length === 1 ? LONELY_BONUS : 0);
    if (score > targetScore + 1e-12) {
      targetScore = score;
      target = g;
      targetMean = mean;
    }
  });

  const noLonelyTable = !groups.some((g) => g.length === 1);
  if (target === -1 && groups.length > 0 && waiting.length === 0) {
    // Everyone is full: wait for company.
    waiting.push(newcomer);
  } else if (target === -1 && groups.length === 0) {
    groups.push([newcomer]);
    target = 0;
  } else if (target === -1) {
    waiting.push(newcomer);
    const [first, second] = waiting.splice(0, 2);
    groups.push([first, second]);
    target = groups.length - 1;
  } else if (targetMean < NEW_TABLE_BELOW && noLonelyTable && groups.length < MAX_TABLES) {
    groups.push([newcomer]);
    target = groups.length - 1;
  } else {
    groups[target].push(newcomer);
  }

  const seated = groups.findIndex((g) => g.some((p) => p.id === newcomer.id));
  return {
    seating: { tables: toTables(groups, people), waiting: waiting.map((p) => p.id) },
    placement: seated === -1 ? { table: null, waiting: true } : { table: seated + 1, waiting: false },
  };
}
