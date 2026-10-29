import type { QlooTag } from "@/src/qloo/schemas";

// A guest's taste, as a short list of weighted tags (). Tags are matched by name, not id, because Qloo
// gives the same name different ids in different domains ("Comedy" for films and for shows).

export type TasteTag = { key: string; name: string; weight: number };
export type TasteVector = TasteTag[];

export type Favourite = { id: string; name: string };

export type Person = {
  id: string;
  favourites: Favourite[];
  vector: TasteVector;
  // Has been to this club before, so seating spreads them across tables.
  regular?: boolean;
};

export const VECTOR_SIZE = 25;

export const tagKey = (name: string): string => name.trim().toLowerCase();

// Builds a vector from Qloo tags. Weights are scaled so the strongest tag is 1; a list with no weights counts every
// tag as 1. Duplicate names keep the heavier one. The result is sorted strongest first, so it is stable to store.
export function toVector(tags: ReadonlyArray<Pick<QlooTag, "name" | "affinity">>, take: number = VECTOR_SIZE): TasteVector {
  const byKey = new Map<string, TasteTag>();
  for (const tag of tags) {
    const key = tagKey(tag.name);
    if (!key) continue;
    const weight = typeof tag.affinity === "number" && tag.affinity > 0 ? tag.affinity : 1;
    const known = byKey.get(key);
    if (!known || weight > known.weight) byKey.set(key, { key, name: tag.name.trim(), weight });
  }
  const list = [...byKey.values()];
  const top = Math.max(0, ...list.map((t) => t.weight));
  return list
    .map((t) => ({ ...t, weight: top > 0 ? Math.round((t.weight / top) * 1000) / 1000 : 0 }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, take);
}

// Sum of min weights over sum of max weights, across the union of tags. 0 when either side is empty.
export function weightedJaccard(a: TasteVector, b: TasteVector): number {
  if (a.length === 0 || b.length === 0) return 0;
  const weightsB = new Map(b.map((t) => [t.key, t.weight]));
  let min = 0;
  let max = 0;
  const seen = new Set<string>();
  for (const tag of a) {
    seen.add(tag.key);
    const other = weightsB.get(tag.key) ?? 0;
    min += Math.min(tag.weight, other);
    max += Math.max(tag.weight, other);
  }
  for (const tag of b) if (!seen.has(tag.key)) max += tag.weight;
  return max === 0 ? 0 : min / max;
}

export function sharedFavourites(a: readonly Favourite[], b: readonly Favourite[]): Favourite[] {
  const ids = new Set(b.map((f) => f.id));
  return a.filter((f) => ids.has(f.id));
}

// 0.75 * tag overlap + 0.25 * "you both picked the same thing".
export function similarity(a: Person, b: Person): number {
  const direct = sharedFavourites(a.favourites, b.favourites).length > 0 ? 1 : 0;
  return 0.75 * weightedJaccard(a.vector, b.vector) + 0.25 * direct;
}

// Cosine similarity of two vectors (used by the Coach to compare the room with the club's theme).
export function cosine(a: TasteVector, b: TasteVector): number {
  if (a.length === 0 || b.length === 0) return 0;
  const weightsB = new Map(b.map((t) => [t.key, t.weight]));
  let dot = 0;
  for (const tag of a) dot += tag.weight * (weightsB.get(tag.key) ?? 0);
  const norm = (v: TasteVector) => Math.sqrt(v.reduce((sum, t) => sum + t.weight * t.weight, 0));
  const denominator = norm(a) * norm(b);
  return denominator === 0 ? 0 : dot / denominator;
}

// The sum of several vectors, as a room's combined taste.
export function sumVectors(vectors: readonly TasteVector[], take: number = VECTOR_SIZE): TasteVector {
  const total = new Map<string, TasteTag>();
  for (const vector of vectors) {
    for (const tag of vector) {
      const known = total.get(tag.key);
      total.set(tag.key, { key: tag.key, name: known?.name ?? tag.name, weight: (known?.weight ?? 0) + tag.weight });
    }
  }
  const list = [...total.values()];
  const top = Math.max(0, ...list.map((t) => t.weight));
  return list
    .map((t) => ({ ...t, weight: top > 0 ? Math.round((t.weight / top) * 1000) / 1000 : 0 }))
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, take);
}
