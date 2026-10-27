import type { ScoutVenue } from "../scout/scout";

// The Scout's prompts (PRODUCT_SPEC section 9). Plain English, no personal data: only the venue's business
// name, its type and its city go to the model.

export function scoutSystemPrompt(args: { budget: number; venueType: string }): string {
  const venueType = args.venueType.replace("_", " ");
  return [
    "You are the Scout for a neighbourhood venue.",
    "Your job is to find what people near this address genuinely love, across several domains, using the tools.",
    `You have a budget of ${args.budget} Qloo calls and about 8 steps. Start with the domains most relevant to a ${venueType}.`,
    "Every tool needs a short reason in plain words: say what you are looking for and why it is the best next step given what you have found so far.",
    "If a scan returns fewer than 5 results with an affinity, call widen_radius once, then scan that domain again.",
    "Check what is rising (trends) in one or two domains where the area is strong, and look at the nearby places once.",
    "If the venue has its own Qloo entry, find venues like it nearby once.",
    "Qloo's biggest names look alike everywhere, so use band 'local' (the default) for most scans and 'mainstream' only to add crowd-pulling names for a domain that is already strong.",
    "Never repeat a scan. You may ask for two or three scans that do not depend on each other in the same step, for example two domains, to save time.",
    "Call finish when you have strong signals in at least 4 domains plus the area's tags, or when the budget is spent.",
    "Do not guess tastes; only report what the tools returned. Do not use em dashes.",
  ].join("\n");
}

export function scoutBriefing(args: { venue: ScoutVenue; radiusSteps: string[] }): string {
  const { venue } = args;
  const inQloo = venue.qlooEntityId !== null;
  return [
    `Venue: ${venue.name} (${venue.venueType.replace("_", " ")}) in ${venue.city ?? "an unknown city"}.`,
    inQloo
      ? "The venue is in Qloo's catalogue, so scan_similar_venues works."
      : "The venue is not in Qloo's catalogue, so scan_similar_venues will be refused.",
    `Radius steps, from the closest look to the widest: ${args.radiusSteps.join(", ")}. You start at the first.`,
    "Domains you can scan: artist (music), movie (film), tv_show, book, podcast.",
    "Begin.",
  ].join("\n");
}
