import { z } from "zod";
import type { PoolSignal } from "../scout/pool";

// The "Without Qloo" comparison (CLAUDE.md section 11): the same question put to a language model that has no Qloo data,
// answered by a real model call. The verdict is computed by code from what the model wrote, never written by hand.

export const baselineSchema = z.object({
  ideas: z.array(z.string().min(5).max(200)).length(3),
});
export type BaselineOutput = z.infer<typeof baselineSchema>;

export const BASELINE_SYSTEM =
  "You are an events advisor. You know nothing about the neighbourhood beyond the address. Do not use em dashes. Plain English.";

export function baselinePrompt(args: { venueType: string; address: string; night: string | null }): string {
  const night = args.night ? args.night : "its quietest night";
  return `Suggest 3 recurring weekly events for a ${args.venueType.replace("_", " ")} at ${args.address} on ${night}. One line each.`;
}

export type BaselineVerdict = {
  total: number;
  tied: number;
  // The area results the ideas mentioned, for the page to show.
  mentions: string[];
  sentence: string;
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names short enough to match by accident ("Up", "It") are left out.
const MIN_NAME_LENGTH = 4;

// Broad genre tags ("Comedy", "Music") appear in almost any event idea, so only specific themes, styles and
// audiences count as the area's tastes. Entity names always count.
function tastes(pool: PoolSignal[]): string[] {
  const names = pool
    .filter((s) => s.kind === "entity" && s.domain !== "place")
    .map((s) => s.name);
  const tags = pool
    .filter((s) => s.kind === "tag" && s.source !== "venue" && /:(theme|style|archetype|audience):/.test(s.tagType ?? ""))
    .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
    .slice(0, 10)
    .map((s) => s.name);
  return [...new Set([...names, ...tags].filter((n) => n.trim().length >= MIN_NAME_LENGTH))];
}

// How many of the model's ideas mention anything the Scout found in this area.
export function baselineVerdict(ideas: string[], pool: PoolSignal[]): BaselineVerdict {
  const names = tastes(pool);
  const mentions = new Set<string>();
  let tied = 0;
  for (const idea of ideas) {
    const hits = names.filter((name) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(idea));
    if (hits.length > 0) tied += 1;
    for (const hit of hits) mentions.add(hit);
  }
  const total = ideas.length;
  const sentence = `LLM only: ${total} ${total === 1 ? "idea" : "ideas"}, ${tied} of ${total} tied to this area's real tastes.`;
  return { total, tied, mentions: [...mentions], sentence };
}
