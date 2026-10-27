// The simulated history of the demo venue (N5). Four past nights with 9, 13, 16 and 21 check-ins, of which 0, 4, 7
// and 10 had been before. Everything built from this is stored with simulated = true and labelled on screen.

export type DemoNight = { total: number; returning: string[] };

const NIGHTS: DemoNight[] = [
  { total: 9, returning: [] },
  { total: 13, returning: ["p1", "p2", "p3", "p4"] },
  { total: 16, returning: ["p1", "p2", "p3", "p5", "p10", "p11", "p12"] },
  { total: 21, returning: ["p1", "p2", "p3", "p4", "p10", "p11", "p13", "p19", "p20", "p5"] },
];

// People are p1, p2, p3 and so on, numbered in the order they first appear.
export function planNights(): string[][] {
  let next = 1;
  return NIGHTS.map((night) => {
    const fresh = Array.from({ length: night.total - night.returning.length }, () => `p${next++}`);
    return [...night.returning, ...fresh];
  });
}

export const DEMO_NAMES = [
  "Maya", "Jonas", "Priya", "Theo", "Amara", "Leo", "Noor", "Sam", "Ines", "Kofi",
  "Hana", "Mateo", "Zoe", "Arjun", "Lucia", "Ben", "Yuki", "Omar", "Elena", "Dev",
  "Freya", "Tariq", "Mina", "Jack", "Sana", "Pablo", "Ivy", "Nico", "Rhea", "Luca",
  "Esme", "Kai", "Dara", "Wes", "Anika", "Remy", "Tess", "Joel",
] as const;

export function nicknameFor(personId: string): string {
  const n = Number(personId.slice(1));
  return DEMO_NAMES[(n - 1) % DEMO_NAMES.length];
}

// A small deterministic generator, so the same seed always builds the same room.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Three favourites for one person from groups of related entities: two from their own group, one from another, so
// the room has clear tastes with some overlap. Picks are ids from the real signal pool.
export function pickFavouriteIds(groups: readonly (readonly string[])[], personId: string): string[] {
  const usable = groups.filter((g) => g.length > 0);
  if (usable.length === 0) return [];
  const n = Number(personId.slice(1));
  const rand = seededRandom(n * 7919);
  const own = usable[(n - 1) % usable.length];
  const other = usable[(n + Math.floor(rand() * (usable.length - 1 || 1))) % usable.length];
  const chosen: string[] = [];
  const take = (pool: readonly string[]) => {
    for (let tries = 0; tries < pool.length * 2 && chosen.length < 3; tries++) {
      const id = pool[Math.floor(rand() * pool.length)];
      if (!chosen.includes(id)) {
        chosen.push(id);
        return;
      }
    }
  };
  take(own);
  take(own);
  take(other === own && usable.length > 1 ? usable[(usable.indexOf(own) + 1) % usable.length] : other);
  // Small pools can leave a gap; fill from anything left so everyone has three.
  for (const id of usable.flat()) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  return chosen.slice(0, 3);
}
