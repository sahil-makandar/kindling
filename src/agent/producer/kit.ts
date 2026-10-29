import { z } from "zod";
import type { ClubFormat, PoolRef } from "../designer/candidates";
import type { PoolSignal } from "../scout/pool";
import { friendlyName, isColdName } from "../naming";

// The Producer's pure logic: the kit schema, how the model's answer is cleaned and checked,
// the playlist (chosen by code from the pool, never by the model), the licence note, and a plain fallback kit so a
// rate-limited model never leaves a club without a kit.

export const KIT_FOOTER = "Club designed with neighbourhood taste data from Qloo.";
export const TRIVIA_WARNING = "Check before use";

const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g");
export const plain = (text: string): string => text.replace(DASHES, ",").replace(/\s+/g, " ").trim();

function clip(text: string, max: number): string {
  const cleaned = plain(text);
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), Math.floor(max / 2))).replace(/[,;:]$/, "")}.`;
}

// What the model writes. Everything the page prints is bounded here, and the code trims what slips past.
export const rawKitSchema = z.object({
  clubName: z.string().min(2).max(60),
  hook: z.string().min(8).max(220),
  durationMinutes: z.number().int().min(60).max(150),
  runOfShow: z
    .array(z.object({ minute: z.number().int().min(0).max(150), title: z.string().min(2).max(60), detail: z.string().min(4).max(300) }))
    .min(4)
    .max(8),
  comeAloneRitual: z.string().min(8).max(400),
  icebreaker: z.string().min(8).max(300),
  nameTagPrompt: z.string().min(4).max(120),
  hostScript: z.string().min(20).max(1600),
  menuSpecial: z.object({
    name: z.string().min(2).max(80),
    description: z.string().min(4).max(300),
    zeroProof: z.object({ name: z.string().min(2).max(80), description: z.string().min(4).max(300) }),
  }),
  listing: z.object({
    title: z.string().min(2).max(100),
    short: z.string().min(10).max(300),
    long: z.string().min(30).max(1500),
    instagram: z.string().min(10).max(500),
  }),
  poster: z.object({ headline: z.string().min(2).max(60), subline: z.string().min(4).max(160) }),
  trivia: z
    .array(z.object({ q: z.string().min(8).max(240), a: z.string().min(1).max(200), source: z.string().max(8).optional() }))
    .min(2)
    .max(5),
});
export type RawKit = z.infer<typeof rawKitSchema>;

export type ClubKit = {
  clubName: string;
  hook: string;
  format: ClubFormat;
  night: string;
  durationMinutes: number;
  runOfShow: Array<{ minute: number; title: string; detail: string }>;
  comeAloneRitual: string;
  icebreaker: string;
  nameTagPrompt: string;
  hostScript: string;
  playlist: Array<{ refId: string; name: string }>;
  menuSpecial: { name: string; description: string; zeroProof: { name: string; description: string } };
  listing: { title: string; short: string; long: string; instagram: string };
  poster: { headline: string; subline: string; footer: string };
  trivia: Array<{ q: string; a: string; sourceRefId?: string }>;
  triviaNote: typeof TRIVIA_WARNING;
  licenceNote?: string;
  // Where the words came from, so the page can say so.
  source: "llm" | "fallback" | "mock" | "cache";
};

// The chosen club, as the Producer sees it. Only names and ids from the Scout's pool, plus the venue's business facts.
export type KitContext = {
  venueName: string;
  venueType: string;
  slowNight: string | null;
  city: string | null;
  title: string;
  format: ClubFormat;
  why: string;
  anchor: PoolRef;
  companions: PoolRef[];
};

const NIGHT_NAME: Record<string, string> = {
  monday: "Mondays",
  tuesday: "Tuesdays",
  wednesday: "Wednesdays",
  thursday: "Thursdays",
  friday: "Fridays",
  saturday: "Saturdays",
  sunday: "Sundays",
};

export const START_TIME = "7:30 pm";

export function nightLabel(slowNight: string | null): string {
  return `${(slowNight && NIGHT_NAME[slowNight]) || "Weeknights"}, ${START_TIME}`;
}

// ---- playlist ----

const PLAYLIST_SIZE = 8;

// Artists from the pool, those that share the most tags with the club's anchor and companions first, then by how
// strongly the area favours them. Chosen by code, so every item is a real pool entity.
export function pickPlaylist(pool: readonly PoolSignal[], refs: readonly PoolRef[]): Array<{ refId: string; name: string }> {
  const wanted = new Set<string>();
  for (const ref of refs) {
    for (const tag of pool.find((s) => s.refId === ref.id)?.tags ?? []) wanted.add(tag.name.toLowerCase());
    if (ref.kind === "tag") wanted.add(ref.name.toLowerCase());
  }
  const artists = pool.filter((s) => s.kind === "entity" && s.domain === "artist");
  const scored = artists.map((artist) => ({
    artist,
    shared: artist.tags.filter((t) => wanted.has(t.name.toLowerCase())).length,
  }));
  scored.sort((a, b) => b.shared - a.shared || (b.artist.affinity ?? 0) - (a.artist.affinity ?? 0) || a.artist.name.localeCompare(b.artist.name));
  const seen = new Set<string>();
  const out: Array<{ refId: string; name: string }> = [];
  for (const { artist } of scored) {
    const key = artist.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ refId: artist.refId, name: artist.name });
    if (out.length === PLAYLIST_SIZE) break;
  }
  return out;
}

// ---- licence ----

const SCREENING = /\b(screen(?:s|ed|ing)?|watch party|movie night|film night|projector|(?:play|show|watch)(?:ing)? (?:the |a )?(?:full |whole )?(?:film|movie))\b/i;

export const LICENCE_NOTE =
  "Showing a whole film in public needs a public performance licence. Short clips of about two minutes to spark a discussion are fine. If you want to screen a full film, ask a licensing service for a one-night licence first.";

export function licenceNoteFor(
  kit: Pick<ClubKit, "clubName" | "hook" | "runOfShow" | "hostScript" | "listing" | "format"> & { poster: { headline: string; subline: string } },
): string | undefined {
  const text = [kit.clubName, kit.hook, kit.hostScript, kit.listing.title, kit.listing.short, kit.listing.long, kit.listing.instagram, kit.poster.headline, kit.poster.subline, ...kit.runOfShow.flatMap((r) => [r.title, r.detail])].join("\n");
  return SCREENING.test(text) ? LICENCE_NOTE : undefined;
}

// ---- resolving the model's answer ----

// Aliases the model may cite as a trivia source. Anything else is dropped.
export function sourceAliases(ctx: Pick<KitContext, "anchor" | "companions">): Map<string, PoolRef> {
  const map = new Map<string, PoolRef>([["anchor", ctx.anchor]]);
  ctx.companions.forEach((c, i) => map.set(`c${i + 1}`, c));
  return map;
}

export function resolveKit(
  raw: RawKit,
  ctx: KitContext,
  pool: readonly PoolSignal[],
  source: ClubKit["source"],
): { kit: ClubKit; notes: string[] } {
  const notes: string[] = [];
  const aliases = sourceAliases(ctx);

  // Steps must run in order and fit inside the night.
  const duration = raw.durationMinutes;
  const ordered = [...raw.runOfShow].sort((a, b) => a.minute - b.minute);
  const fitting = ordered.filter((step) => step.minute < duration);
  if (fitting.length < ordered.length) notes.push(`Dropped ${ordered.length - fitting.length} run-of-show step(s) that started after the night ends.`);
  const runOfShow = fitting.map((step) => ({ minute: step.minute, title: clip(step.title, 60), detail: clip(step.detail, 300) }));

  const trivia = raw.trivia.map((item) => {
    const ref = item.source ? aliases.get(item.source) : undefined;
    if (item.source && !ref) notes.push(`Removed an unknown trivia source "${item.source}".`);
    return { q: clip(item.q, 240), a: clip(item.a, 200), ...(ref ? { sourceRefId: ref.id } : {}) };
  });

  const hostWords = plain(raw.hostScript).split(" ");
  const hostScript = hostWords.length > 180 ? `${hostWords.slice(0, 180).join(" ").replace(/[,;:]$/, "")}.` : plain(raw.hostScript);
  if (hostWords.length > 180) notes.push("Trimmed the host script to 180 words.");

  const kit: ClubKit = {
    clubName: clip(isColdName(raw.clubName) ? (isColdName(ctx.title) ? friendlyName({ anchor: ctx.anchor.name, companion: ctx.companions[0]?.name ?? null, format: ctx.format, night: ctx.slowNight }) : ctx.title) : raw.clubName, 40),
    hook: clip(raw.hook, 110),
    format: ctx.format,
    night: nightLabel(ctx.slowNight),
    durationMinutes: duration,
    runOfShow,
    comeAloneRitual: clip(raw.comeAloneRitual, 400),
    icebreaker: clip(raw.icebreaker, 300),
    nameTagPrompt: clip(raw.nameTagPrompt, 120),
    hostScript,
    playlist: pickPlaylist(pool, [ctx.anchor, ...ctx.companions]),
    menuSpecial: {
      name: clip(raw.menuSpecial.name, 80),
      description: clip(raw.menuSpecial.description, 300),
      zeroProof: { name: clip(raw.menuSpecial.zeroProof.name, 80), description: clip(raw.menuSpecial.zeroProof.description, 300) },
    },
    listing: {
      title: clip(raw.listing.title, 100),
      short: clip(raw.listing.short, 300),
      long: plain(raw.listing.long).slice(0, 1500),
      instagram: plain(raw.listing.instagram).slice(0, 500),
    },
    poster: { headline: clip(raw.poster.headline, 60), subline: clip(raw.poster.subline, 160), footer: KIT_FOOTER },
    trivia,
    triviaNote: TRIVIA_WARNING,
    source,
  };

  // Words the model wrote are checked for screenings; the rule never depends on the model remembering.
  const licence = licenceNoteFor(kit);
  if (licence) kit.licenceNote = licence;
  return { kit, notes };
}

// ---- the fallback kit ----

const FORMAT_SHOW: Record<ClubFormat, string> = {
  discussion_club: "a short, open discussion",
  listening_night: "a shared listening session",
  book_club: "a relaxed book chat",
  game_night: "a few rounds of a table game",
  trivia_night: "a friendly quiz",
  fan_meetup: "a fan meetup",
  tasting: "a guided tasting",
};

const SERVE: Record<string, { drink: string; zero: string }> = {
  cafe: { drink: "house latte", zero: "iced tea" },
  bookstore: { drink: "pot of tea", zero: "hot chocolate" },
  bar: { drink: "signature cocktail", zero: "zero-proof spritz" },
  brewery: { drink: "small-batch pour", zero: "hop water" },
  restaurant: { drink: "chef's small plate", zero: "house soda" },
  music_venue: { drink: "house pour", zero: "ginger soda" },
  community_space: { drink: "hot drink", zero: "fruit cooler" },
};

// The same shape the model would give, written from templates. Plain, and honest about being plain.
export function standardRawKit(ctx: KitContext): RawKit {
  const anchor = ctx.anchor.name;
  const [first, second] = ctx.companions;
  const theme = [anchor, first?.name, second?.name].filter(Boolean).join(", ");
  const serve = SERVE[ctx.venueType] ?? SERVE.community_space;
  const night = NIGHT_NAME[ctx.slowNight ?? ""] ?? "Weeknights";
  return {
    clubName: ctx.title,
    hook: `A weekly night for people who love ${anchor}.`,
    durationMinutes: 90,
    runOfShow: [
      { minute: 0, title: "Doors and name tags", detail: `Greet people at the door. Each name tag has a line to finish: ask me about ${anchor}.` },
      { minute: 15, title: "Find your table", detail: "Guests check in with the QR code and are seated with people who share their taste." },
      { minute: 30, title: "Welcome", detail: `The host says hello and explains what the club is about: ${theme}.` },
      { minute: 40, title: "The main part", detail: `${FORMAT_SHOW[ctx.format][0].toUpperCase()}${FORMAT_SHOW[ctx.format].slice(1)}, led by the host.` },
      { minute: 70, title: "Table talk", detail: "Tables share one thing they agreed on and one thing they did not." },
      { minute: 85, title: "See you next week", detail: "Tell everyone next week's theme and thank them for coming." },
    ],
    comeAloneRitual: "The host meets newcomers at the door, hands them a name tag and walks them to a table where someone already likes the same things.",
    icebreaker: `What is the first thing you loved about ${anchor}?`,
    nameTagPrompt: `Ask me about ${anchor}`,
    hostScript: `Welcome, everyone. This is ${ctx.title}, our ${night.toLowerCase().replace(/s$/, "")} night at ${ctx.venueName}. You are here because this neighbourhood loves ${theme}. Look at your table: you were seated with people who share your taste. Tonight we will do ${FORMAT_SHOW[ctx.format]}, and then we will talk. There are no wrong answers. Come back next week and bring someone.`,
    menuSpecial: {
      name: `${anchor} ${serve.drink}`,
      description: `A ${serve.drink} made for the night, inspired by ${anchor}.`,
      zeroProof: { name: `${anchor} ${serve.zero}`, description: `The same idea as a ${serve.zero} with no alcohol.` },
    },
    listing: {
      title: ctx.title,
      short: `A weekly night at ${ctx.venueName} for people who love ${anchor}.`,
      long: `${ctx.title} meets every week at ${ctx.venueName}. It is built around what this neighbourhood loves: ${theme}. Come alone or bring a friend. You will be seated with people who share your taste, so there is always someone to talk to.`,
      instagram: `${ctx.title} at ${ctx.venueName}, ${night.toLowerCase()} at ${START_TIME}. For people who love ${anchor}. Come alone, leave with new regulars.`,
    },
    poster: { headline: ctx.title, subline: `A weekly night for people who love ${anchor}.` },
    trivia: [
      { q: `Which of ${theme} would you recommend to a stranger first, and why?`, a: "There is no single answer. Ask the table.", source: "anchor" },
      { q: `What would you add to this list that belongs with ${anchor}?`, a: "Any answer is good. Write the best ones on the board." },
    ],
  };
}
