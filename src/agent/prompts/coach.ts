import type { Decision } from "@/src/coach/signals";

// The Coach's prompts (PRODUCT_SPEC section 9). The model receives numbers and tag names for the whole room, never a
// person's name or their individual picks, and it does not decide: the decision arrives already made.

export const COACH_SYSTEM = [
  "You are the Coach for a weekly club at a neighbourhood venue. You write next week's plan after the owner has seen how this week went.",
  "The decision (keep, tweak or switch) is already made from the numbers. Do not change it. Write the next session's variant for it.",
  "Write plain English with short sentences. No em dashes. Avoid hype and marketing language.",
  "keep: stay in the same club but give it a fresh sub-theme so it does not go stale. tweak: move the theme towards what the room loves. switch: propose a new direction built from the room's taste.",
  "variantTitle: at most 6 words. hook: one line, at most 110 characters. runOfShowChange: one concrete change to the running order that staff can do next week, one or two sentences.",
  "rationale: two or three sentences for the owner. It must quote the real numbers you are given, such as the share of guests who came back and the check-ins per night, and say why the decision follows.",
  "Use only the tags and themes you are given. Do not invent facts about films, music or people.",
].join("\n");

export type CoachPromptInput = {
  decision: Decision;
  reasons: string[];
  clubTitle: string;
  venueType: string;
  night: string | null;
  attendance: number[];
  trend: number;
  returnRate: number;
  regularsMade: number;
  drift: number;
  roomTags: string[];
  clubTags: string[];
  adjacent: string[];
  roomFavourites: string[];
  nextBest: string | null;
};

export function coachPrompt(input: CoachPromptInput): string {
  const lines = [
    `Club: ${input.clubTitle}, at a ${input.venueType.replace("_", " ")}${input.night ? `, on ${input.night}` : ""}.`,
    `Decision already made: ${input.decision.toUpperCase()}. Reason: ${input.reasons.join(" ")}`,
    `Check-ins per night, oldest first: ${input.attendance.join(", ")}. Trend: ${input.trend > 0 ? "+" : ""}${input.trend} a night.`,
    `Share of last night's guests who had been before: ${Math.round(input.returnRate * 100)}%. Regulars made so far (3 or more visits): ${input.regularsMade}.`,
    `Drift between the room's taste and the club's theme: ${input.drift.toFixed(2)} (0 means identical, 1 means unrelated).`,
  ];
  if (input.clubTags.length > 0) lines.push(`The club's theme tags: ${input.clubTags.join(", ")}.`);
  if (input.roomTags.length > 0) lines.push(`What last night's room loves, strongest first: ${input.roomTags.join(", ")}.`);
  if (input.roomFavourites.length > 0) lines.push(`Most picked favourites last night: ${input.roomFavourites.join(", ")}.`);
  if (input.adjacent.length > 0) lines.push(`Themes Qloo says sit next to what this room loves: ${input.adjacent.join(", ")}.`);
  if (input.decision === "switch" && input.nextBest) lines.push(`The next best idea from the original run was: ${input.nextBest}.`);
  lines.push("", "Write the variant and the rationale now.");
  return lines.join("\n");
}
