// Club names should sound like something a neighbour would say out loud. The prompts say how; this module is the check
// in code, because a model sometimes writes "The Billie Live Sound Session" anyway.

// Endings and phrases that make a name sound like a corporate programme or a template.
const COLD_ENDING = /\b(sessions?|experience|experiences|hub|vibes?|collective|series|programme|program|event|activation|showcase)$/i;
const COLD_PHRASE = /\b(live sound|sound session|curated|immersive|ultimate|vibe check)\b/i;

export function isColdName(name: string): boolean {
  const text = name.trim();
  return COLD_ENDING.test(text) || COLD_PHRASE.test(text);
}

export const NAMING_RULES = [
  "Names must sound like something a neighbour would say out loud: warm, short, human. Two to five words.",
  "Good: 'Ghibli and Ramen Tuesdays', 'Slow Jams Supper Club', 'The Wednesday Book Swap', 'Second Chances Film Club', 'Pints and Pub Quiz'.",
  "Bad: 'The Billie Live Sound Session', 'Ultimate Film Experience', 'Vibes Collective', 'Curated Listening Series', 'Cinema Hub'.",
  "Never end a name with Session, Experience, Hub, Vibes, Collective, Series or Event. Never use 'live sound', 'curated' or 'immersive'.",
  "A name can use the night ('Tuesdays'), a food or drink, or the word Club, Supper, Swap, Quiz or Nights. Do not use an artist's full name twice.",
].join("\n");

// A plain, warm name built from what a club is about, for when the model's name fails the check.
export function friendlyName(args: { anchor: string; companion: string | null; format: string; night: string | null }): string {
  const short = (text: string) => text.split(/[:(]/)[0].trim().split(/\s+/).slice(0, 3).join(" ");
  const anchor = short(args.anchor);
  const companion = args.companion ? short(args.companion) : null;
  const night = args.night ? `${args.night[0].toUpperCase()}${args.night.slice(1).toLowerCase()}s` : null;
  if (args.format === "book_club") return `${anchor} Book Club`;
  if (args.format === "trivia_night") return `${anchor} Pub Quiz`;
  if (args.format === "game_night") return `${anchor} Game Night`;
  if (args.format === "tasting") return `${anchor} Supper Club`;
  if (companion && night) return `${anchor} and ${companion} ${night}`;
  if (night) return `${anchor} ${night}`;
  return `${anchor} Club`;
}
