import { FORMAT_LABEL } from "../designer/candidates";
import { NAMING_RULES } from "../naming";
import type { KitContext } from "../producer/kit";

// The Producer's prompts (PRODUCT_SPEC section 9). The model sees the chosen club's names and the venue's business
// facts only. It never sees attendee data, and it cannot add anything to the playlist: the code picks that.

export const PRODUCER_SYSTEM = [
  "You are the Producer for a neighbourhood venue. You turn one chosen hidden club into a kit the staff can run next week.",
  "Write warm, plain English with short sentences. No em dashes. Avoid hype and marketing language.",
  "Be specific to the club's theme and the venue type. Staff are busy: every instruction must be something they can do with the room and drinks they already have.",
  "Never plan to screen a full film or play a full album from a streaming service in public. Use short clips of about two minutes or a few songs to start a conversation.",
  "The night starts at 7:30 pm, which is when doors open. Use that time wherever you mention a time.",
  "clubName: two to five words. " + NAMING_RULES,
  "hook: one line, at most 110 characters.",
  "runOfShow: 5 to 7 steps. minute is when the step starts, counting from doors open at 0, increasing, and every step starts before the night ends. durationMinutes is 90 to 120.",
  "comeAloneRitual: how a person who arrives alone is welcomed and placed. nameTagPrompt: a line for the name tag such as 'Ask me about ...'.",
  "hostScript: what the host says to open the night, at most 180 words.",
  "menuSpecial: one food or drink item that fits the theme and a zero-proof version. Keep it simple for a venue of this type.",
  "listing: title, a short line, a long description of about 80 words, and an Instagram caption.",
  "poster: headline (the club name or a short version) and a subline.",
  "trivia: 3 questions about the anchor or companions, each with a short answer. Only ask what you are sure is true. If you are not sure of a fact, ask an opinion question instead and give the answer 'Your call'. Set source to anchor, c1 or c2 when a question is about that item, otherwise leave it out.",
].join("\n");

export function producerPrompt(ctx: KitContext): string {
  const companions = ctx.companions.map((c, i) => `  c${i + 1}: ${c.name} (${c.domain})`);
  return [
    `Venue: ${ctx.venueName}, a ${ctx.venueType.replace("_", " ")}${ctx.city ? ` in ${ctx.city}` : ""}.${ctx.slowNight ? ` The club runs on ${ctx.slowNight} nights.` : ""}`,
    `Club idea: ${ctx.title}.`,
    `Format: ${FORMAT_LABEL[ctx.format]}.`,
    "Built from what people in the area love:",
    `  anchor: ${ctx.anchor.name} (${ctx.anchor.domain})`,
    ...companions,
    `Why it was picked: ${ctx.why}`,
    "",
    "Write the kit now.",
  ].join("\n");
}
