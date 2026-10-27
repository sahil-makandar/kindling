import { cosine, type TasteVector } from "@/src/seating/tasteVector";

// The Coach's deterministic half (PRODUCT_SPEC 5.6): the signals and the decision. All pure. The language model only
// writes the variant and the wording; it never decides keep, tweak or switch.

export type SessionStats = {
  number: number;
  date: string;
  // People who checked in, or the host's own headcount when it is higher.
  attendance: number;
  checkedIn: number;
  // Of those who checked in, how many had been to this club on an earlier night.
  returning: number;
  simulated: boolean;
  vibeRating: number | null;
};

// Least-squares slope of the values against their position: people gained per session. 0 for fewer than two values.
export function slope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  return num / den;
}

// Slope over the last three sessions.
export const trendOf = (attendance: readonly number[]): number => Math.round(slope(attendance.slice(-3)) * 100) / 100;

// How many sessions in a row, counting back from the latest, attendance went down.
export function consecutiveDeclines(attendance: readonly number[]): number {
  let count = 0;
  for (let i = attendance.length - 1; i > 0; i--) {
    if (attendance[i] < attendance[i - 1]) count += 1;
    else break;
  }
  return count;
}

export const returnRateOf = (stats: Pick<SessionStats, "checkedIn" | "returning">): number =>
  stats.checkedIn === 0 ? 0 : Math.round((stats.returning / stats.checkedIn) * 1000) / 1000;

// People who have been to the club three or more times.
export const REGULAR_VISITS = 3;
export function regularsMade(visitsPerPerson: ReadonlyMap<string, number> | readonly number[]): number {
  const counts = Array.isArray(visitsPerPerson) ? visitsPerPerson : [...(visitsPerPerson as ReadonlyMap<string, number>).values()];
  return counts.filter((n) => n >= REGULAR_VISITS).length;
}

// Pairs who sat at the same table by taste and had not shared a table on any earlier night. Sessions are in order;
// each is a list of tables; each table is a list of person ids.
export function strangersSeated(sessionsTables: ReadonlyArray<ReadonlyArray<readonly string[]>>): number {
  const met = new Set<string>();
  let fresh = 0;
  for (const tables of sessionsTables) {
    const thisNight = new Set<string>();
    for (const table of tables) {
      const people = [...new Set(table)].sort();
      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          const pair = `${people[i]}|${people[j]}`;
          if (!met.has(pair) && !thisNight.has(pair)) {
            fresh += 1;
            thisNight.add(pair);
          }
        }
      }
    }
    for (const pair of thisNight) met.add(pair);
  }
  return fresh;
}

// 0 when the room loves what the club is about, towards 1 when it has drifted away.
export function driftOf(room: TasteVector, club: TasteVector): number {
  if (room.length === 0 || club.length === 0) return 0;
  return Math.round(Math.max(0, 1 - cosine(room, club)) * 1000) / 1000;
}

export type CoachSignals = {
  sessions: number;
  attendance: number[];
  trend: number;
  declines: number;
  returnRate: number;
  drift: number;
  regularsMade: number;
};

export type Decision = "keep" | "tweak" | "switch";

export const THRESHOLDS = { keepReturnRate: 0.3, tweakDrift: 0.65, tweakMinTrend: -1, switchReturnRate: 0.2, switchDeclines: 2 } as const;

export function decide(s: CoachSignals): { decision: Decision; reasons: string[] } {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const drifted = s.drift > THRESHOLDS.tweakDrift;
  if (s.sessions < 2) {
    return {
      decision: "keep",
      reasons: [
        `Only one night so far, which is too early to judge. Keep it and see who comes back.${drifted ? ` The room's taste is already far from the club's theme (drift ${s.drift.toFixed(2)}, above ${THRESHOLDS.tweakDrift}), so the next report will weigh that.` : ""}`,
      ],
    };
  }
  // Order matters. A club in real trouble switches. A room that has moved away from the theme while attendance holds is
  // tweaked, even if the club is doing well, because the room is telling us what it wants. Then a healthy club keeps.
  if (s.declines >= THRESHOLDS.switchDeclines && s.returnRate < THRESHOLDS.switchReturnRate) {
    return {
      decision: "switch",
      reasons: [`Attendance fell ${s.declines} nights in a row and only ${pct(s.returnRate)} of the last night came back, below the ${pct(THRESHOLDS.switchReturnRate)} line.`],
    };
  }
  if (drifted && s.trend >= THRESHOLDS.tweakMinTrend) {
    const healthy = s.trend >= 0 && s.returnRate >= THRESHOLDS.keepReturnRate;
    return {
      decision: "tweak",
      reasons: [
        `The room's taste has drifted from the club's theme (drift ${s.drift.toFixed(2)}, above ${THRESHOLDS.tweakDrift}) while attendance is ${healthy ? `healthy, ${pct(s.returnRate)} of the last night came back` : "holding"}. Keep what works and lean the night towards what the room loves.`,
      ],
    };
  }
  if (s.trend >= 0 && s.returnRate >= THRESHOLDS.keepReturnRate) {
    return {
      decision: "keep",
      reasons: [`Attendance is ${s.trend > 0 ? `growing by about ${s.trend} a night` : "steady"} and ${pct(s.returnRate)} of the last night came back, above the ${pct(THRESHOLDS.keepReturnRate)} line, and the room still loves the theme (drift ${s.drift.toFixed(2)}).`],
    };
  }
  if (s.trend < 0) {
    return {
      decision: "tweak",
      reasons: [`Attendance is slipping by about ${Math.abs(s.trend)} a night and ${pct(s.returnRate)} came back, so change something small before it becomes a trend.`],
    };
  }
  return {
    decision: "keep",
    reasons: [`Attendance is steady, but only ${pct(s.returnRate)} came back, below the ${pct(THRESHOLDS.keepReturnRate)} line. Keep the club and give returning guests a reason to return.`],
  };
}

export function buildSignals(args: { sessions: readonly SessionStats[]; room: TasteVector; club: TasteVector; visitsPerPerson: ReadonlyMap<string, number> }): CoachSignals {
  const attendance = args.sessions.map((s) => s.attendance);
  const last = args.sessions.at(-1);
  return {
    sessions: args.sessions.length,
    attendance,
    trend: trendOf(attendance),
    declines: consecutiveDeclines(attendance),
    returnRate: last ? returnRateOf(last) : 0,
    drift: driftOf(args.room, args.club),
    regularsMade: regularsMade(args.visitsPerPerson),
  };
}
