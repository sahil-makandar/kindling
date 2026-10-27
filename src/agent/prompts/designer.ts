import { DOMAIN_LABEL } from "../scout/plan";
import { NAMING_RULES } from "../naming";
import { CLUB_FORMATS, type PromptView } from "../designer/candidates";

// The Designer's prompts (PRODUCT_SPEC section 9). The model sees short aliases and compact lines, never raw Qloo
// data, and cites aliases back. No personal data: only the venue's business name, type and city.

export const DESIGNER_SYSTEM = [
  "You are the Designer for a neighbourhood venue.",
  "You propose hidden clubs: a weekly night built around a taste that this specific area loves, for people who share it.",
  "Propose 6 to 8 clubs.",
  "Use only the ids listed (for example m1, a3, l2). Every club has one anchor, which is a strong local signal from the film, music, TV, books or podcasts lists (or a genre or theme tag), never a place or a vibe tag, and one or two companions that come from DIFFERENT lists than the anchor (for example a film anchor with a music companion and a place companion). Companions may be places or genre and theme tags.",
  "Prefer themes that feel like identity, such as a night for fans of something, over generic categories. Prefer distinctive picks over the very biggest names, but use a household name when it is the best anchor for a crowd. A rising pick is a good sign.",
  `The format is one of: ${CLUB_FORMATS.join(", ")}. discussion_club means talk about a film, show or creator with short clips only. Never propose screening a full film, because that needs a public performance licence.`,
  "Fit the club to THIS venue. Film, music, TV, book and podcast taste is city-wide, so it is the same for every venue in the city. What makes a club right for this venue is its own tags, the places within 1 km, and the kind of night the venue can host. A brewery gets a different club than a cafe in the same city: pick the format and the companions that suit the venue and its neighbours, and use a nearby place as a companion when one fits.",
  "title: two to five words, warm and human. " + NAMING_RULES,
  "why: one sentence that names the anchor and the companions and gives the evidence, for example shared genre or theme tags, that it is rising, or that a nearby place fits it.",
  "Do not use em dashes. Plain English.",
].join("\n");

export function designerPrompt(args: { venueName: string; venueType: string; city: string | null; slowNight: string | null; view: PromptView }): string {
  const { view } = args;
  const lines: string[] = [];
  lines.push(
    `Venue: ${args.venueName}, a ${args.venueType.replace("_", " ")}${args.city ? ` in ${args.city}` : ""}.${args.slowNight ? ` Its quietest night is ${args.slowNight}.` : ""}`,
  );
  if (view.venueTags.length > 0) lines.push(`The venue's own tags on Qloo: ${view.venueTags.join(", ")}.`);

  lines.push("", "What people in the area love, by list. Each line is: id | name | popularity 0 to 1 | tags. 'rising' means it is trending here.");
  for (const { domain, items } of view.domains) {
    lines.push(`${DOMAIN_LABEL[domain]}:`);
    for (const item of items) {
      const popularity = item.popularity === undefined ? "" : ` | ${item.popularity}`;
      lines.push(`  ${item.alias} | ${item.name}${popularity} | ${item.tags.join(", ")}${item.rising ? " | rising" : ""}`);
    }
  }

  if (view.places.length > 0) {
    lines.push("", "Nearby places (id | name | categories):");
    for (const place of view.places) lines.push(`  ${place.alias} | ${place.name} | ${place.categories.join(", ")}`);
  }
  if (view.themeTags.length > 0) lines.push("", `Genres and themes the area loves: ${view.themeTags.map((t) => `${t.alias} ${t.name}`).join("; ")}.`);
  if (view.vibeTags.length > 0) lines.push(`The vibe of the area's places: ${view.vibeTags.map((t) => `${t.alias} ${t.name}`).join("; ")}.`);

  lines.push("", "Return the clubs now.");
  return lines.join("\n");
}
