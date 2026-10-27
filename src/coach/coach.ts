import { z } from "zod";
import type { Llm } from "@/src/agent/llm";
import { COACH_SYSTEM, coachPrompt } from "@/src/agent/prompts/coach";
import { plain } from "@/src/agent/producer/kit";
import type { TasteVector } from "@/src/seating/tasteVector";
import { buildSignals, decide, type CoachSignals, type Decision } from "./signals";
import type { Weeks } from "./weeks";

// The Coach: after a night, reads the numbers, decides keep, tweak or switch with fixed rules, and has the language
// model write next week's variant and the reasons. If no model answers, the same shape is written from templates.

export const rawVariantSchema = z.object({
  variantTitle: z.string().min(2).max(80),
  hook: z.string().min(8).max(220),
  runOfShowChange: z.string().min(8).max(500),
  rationale: z.string().min(20).max(900),
});
export type Variant = z.infer<typeof rawVariantSchema>;

export type Proposal = { variantTitle: string; hook: string; runOfShowChange: string };

export type RecommendationSignals = CoachSignals & {
  roomTags: string[];
  clubTags: string[];
  adjacent: string[];
  roomFavourites: string[];
  // True when Qloo gave no theme tags for the club, so drift is not measured.
  driftMissing: boolean;
};

export type Recommendation = {
  id: string;
  clubId: string;
  afterSessionId: string | null;
  decision: Decision;
  signals: RecommendationSignals;
  proposal: Proposal;
  rationale: string;
  status: "proposed" | "accepted" | "edited" | "rejected";
  source: "llm" | "fallback" | "mock" | "cache";
};

export type CoachClub = {
  clubId: string;
  runId: string;
  title: string;
  venueType: string;
  slowNight: string | null;
  baseline: number | null;
  weeks: Weeks;
  // Anchor and companions that are real media entities, as ids for Qloo. Places and tags are left out.
  themeEntityIds: string[];
  // A media domain to ask for adjacent themes in, and a place to centre the search on.
  themeDomain: "artist" | "movie" | "tv_show" | "book" | "podcast" | null;
  venue: { lat: number; lon: number };
  nextBestTitle: string | null;
  existing: Recommendation | null;
};

export type CoachDeps = {
  load(clubId: string): Promise<CoachClub | null>;
  // The club's theme as a taste vector, from Qloo. Empty when the theme has no media entity to ask about.
  clubTaste(themeEntityIds: string[]): Promise<TasteVector>;
  // Names of entities Qloo says sit next to what the room loves, near the venue.
  adjacentThemes(args: { domain: NonNullable<CoachClub["themeDomain"]>; seedIds: string[]; venue: { lat: number; lon: number } }): Promise<string[]>;
  save(rec: Omit<Recommendation, "id">): Promise<Recommendation>;
  generateStructured: Llm["generateStructured"];
};

const topNames = (vector: TasteVector, n: number) => vector.slice(0, n).map((t) => t.name);

// Does the rationale quote the real numbers? The owner is meant to see why, in figures.
export function quotesNumbers(rationale: string, s: Pick<CoachSignals, "returnRate" | "attendance" | "regularsMade">): boolean {
  const percent = `${Math.round(s.returnRate * 100)}%`;
  const last = s.attendance.at(-1);
  return rationale.includes(percent) || (last !== undefined && new RegExp(`\\b${last}\\b`).test(rationale));
}

// Wording written by code: used when no model answers, and as the safety net for a rationale without numbers.
export function standardVariant(decision: Decision, reasons: string[], s: RecommendationSignals, clubTitle: string): Variant {
  const next = s.adjacent[0] ?? s.roomTags[0] ?? "a fresh angle";
  const room = s.roomTags[0] ?? "what the room loves";
  const numbers = `Check-ins went ${s.attendance.join(", ")} and ${Math.round(s.returnRate * 100)}% of the last night had been before.`;
  const plan: Record<Decision, Pick<Variant, "variantTitle" | "hook" | "runOfShowChange">> = {
    keep: {
      variantTitle: `${clubTitle}: ${next} edition`,
      hook: `Same club, with a twist: ${next}.`,
      runOfShowChange: `Swap one discussion round for a round about ${next}, and ask returning guests to bring someone new.`,
    },
    tweak: {
      variantTitle: `${clubTitle}: more ${room}`,
      hook: `This week the club leans into ${room}.`,
      runOfShowChange: `Make the main part of the night about ${room}, with a short warm-up round on the old theme so nobody feels dropped.`,
    },
    switch: {
      variantTitle: `${room} night`,
      hook: `A new theme built from what the room loves: ${room}.`,
      runOfShowChange: `Open with a short note on why the theme is changing, then run the night around ${room}.`,
    },
  };
  return { ...plan[decision], rationale: plain(`${numbers} ${reasons.join(" ")}`).slice(0, 900) };
}

export function createCoach(deps: CoachDeps) {
  return async function recommend(clubId: string, options: { force?: boolean } = {}): Promise<{ recommendation: Recommendation; created: boolean } | null> {
    const club = await deps.load(clubId);
    if (!club) return null;
    const { weeks } = club;
    if (weeks.sessions.length === 0) return null;
    // One recommendation per night. Opening the page again never asks the model again.
    if (club.existing && !options.force && club.existing.afterSessionId === weeks.latestSessionId) return { recommendation: club.existing, created: false };

    const clubVector = club.themeEntityIds.length > 0 ? await deps.clubTaste(club.themeEntityIds).catch(() => []) : [];
    const base = buildSignals({ sessions: weeks.sessions, room: weeks.roomVector, club: clubVector, visitsPerPerson: weeks.visitsPerPerson });
    const { decision, reasons } = decide(base);

    const seedIds = weeks.roomFavourites.filter((f) => f.count >= 1).slice(0, 5).map((f) => f.id);
    const adjacent = club.themeDomain && seedIds.length > 0 ? await deps.adjacentThemes({ domain: club.themeDomain, seedIds, venue: club.venue }).catch(() => []) : [];

    const signals: RecommendationSignals = {
      ...base,
      roomTags: topNames(weeks.roomVector, 8),
      clubTags: topNames(clubVector, 8),
      adjacent: adjacent.slice(0, 6),
      roomFavourites: weeks.roomFavourites.map((f) => f.name),
      driftMissing: clubVector.length === 0,
    };

    const fallback = () => standardVariant(decision, reasons, signals, club.title);
    const result = await deps.generateStructured(
      rawVariantSchema,
      coachPrompt({
        decision,
        reasons,
        clubTitle: club.title,
        venueType: club.venueType,
        night: club.slowNight,
        attendance: signals.attendance,
        trend: signals.trend,
        returnRate: signals.returnRate,
        regularsMade: signals.regularsMade,
        drift: signals.drift,
        roomTags: signals.roomTags,
        clubTags: signals.clubTags,
        adjacent: signals.adjacent,
        roomFavourites: signals.roomFavourites.slice(0, 5),
        nextBest: club.nextBestTitle,
      }),
      {
        runId: club.runId,
        cacheKey: `coach:${weeks.latestSessionId}${options.force ? `:${Date.now()}` : ""}`,
        tier: "main",
        system: COACH_SYSTEM,
        maxOutputTokens: 1200,
        fallback,
        mock: fallback,
        check: (value) => {
          if (!quotesNumbers(value.rationale, signals)) {
            throw new Error("The rationale must quote the real numbers: the percentage of guests who came back and the check-ins last night.");
          }
        },
      },
    );

    const out = result.output;
    // A model answer that still has no numbers is replaced, so the owner always sees the figures.
    const rationale = quotesNumbers(out.rationale, signals) ? plain(out.rationale) : fallback().rationale;
    const recommendation = await deps.save({
      clubId,
      afterSessionId: weeks.latestSessionId,
      decision,
      signals,
      proposal: { variantTitle: plain(out.variantTitle).slice(0, 80), hook: plain(out.hook).slice(0, 110), runOfShowChange: plain(out.runOfShowChange).slice(0, 500) },
      rationale,
      status: "proposed",
      source: result.source,
    });
    return { recommendation, created: true };
  };
}
