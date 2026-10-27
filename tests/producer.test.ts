import { describe, expect, it } from "vitest";
import type { ClubFormat, PoolRef } from "@/src/agent/designer/candidates";
import { createProduceKit } from "@/src/agent/producer/stage";
import {
  KIT_FOOTER,
  LICENCE_NOTE,
  licenceNoteFor,
  nightLabel,
  pickPlaylist,
  rawKitSchema,
  resolveKit,
  standardRawKit,
  type ClubKit,
  type KitContext,
  type RawKit,
} from "@/src/agent/producer/kit";
import { PRODUCER_SYSTEM, producerPrompt } from "@/src/agent/prompts/producer";
import type { PoolSignal } from "@/src/agent/scout/pool";
import { CODE_ALPHABET, CODE_LENGTH, generateCheckInCode, nextOccurrence, normaliseCode } from "@/src/clubs/sessions";

const anchor: PoolRef = { id: "fx_movie_1", kind: "entity", domain: "movie", name: "Spirited Away" };
const companions: PoolRef[] = [
  { id: "fx_artist_1", kind: "entity", domain: "artist", name: "Nujabes" },
  { id: "fx_place_1", kind: "entity", domain: "place", name: "Tonkotsu Alley" },
];

const ctx: KitContext = {
  venueName: "The Slow Pour",
  venueType: "cafe",
  slowNight: "tuesday",
  city: "New York",
  title: "Ghibli and Lo-fi Tuesdays",
  format: "discussion_club" as ClubFormat,
  why: "Spirited Away is rising here.",
  anchor,
  companions,
};

const signal = (refId: string, name: string, extra: Partial<PoolSignal> = {}): PoolSignal => ({
  refId,
  kind: "entity",
  domain: "artist",
  source: "area",
  name,
  tags: [],
  appearances: {},
  callId: null,
  ...extra,
});

const tag = (name: string) => ({ id: `tag_${name}`, name });

const pool: PoolSignal[] = [
  signal("fx_movie_1", "Spirited Away", { domain: "movie", tags: [tag("anime"), tag("fantasy")] }),
  signal("fx_artist_1", "Nujabes", { tags: [tag("lo-fi"), tag("jazz hop")], affinity: 0.5 }),
  signal("fx_artist_2", "Joe Hisaishi", { tags: [tag("anime")], affinity: 0.2 }),
  signal("fx_artist_3", "Metallica", { tags: [tag("metal")], affinity: 0.99 }),
  signal("fx_artist_4", "Tycho", { tags: [], affinity: 0.7 }),
];

const goodRaw = (): RawKit => ({
  clubName: "Ghibli and Lo-fi Tuesdays",
  hook: "Talk about the films you grew up on, over a warm drink.",
  durationMinutes: 90,
  runOfShow: [
    { minute: 40, title: "Clip and talk", detail: "Play a two minute clip, then ask the table what stood out." },
    { minute: 0, title: "Doors", detail: "Greet people and hand out name tags." },
    { minute: 15, title: "Find your table", detail: "Scan the code and sit with people who share your taste." },
    { minute: 120, title: "After hours", detail: "This starts after the night ends." },
  ],
  comeAloneRitual: "The host greets newcomers and walks them to a table.",
  icebreaker: "Which scene do you rewatch the most?",
  nameTagPrompt: "Ask me about Spirited Away",
  hostScript: "Welcome everyone, tonight we talk about the films we love. There are no wrong answers.",
  menuSpecial: {
    name: "Soot sprite latte",
    description: "A black sesame latte.",
    zeroProof: { name: "Cloud tea", description: "Iced milk tea with no alcohol." },
  },
  listing: { title: "Ghibli and Lo-fi Tuesdays", short: "A weekly film chat night for fans.", long: "Come alone and sit with people who love the same films you do. We talk, we listen, we drink tea.", instagram: "Tuesdays at 7:30. Come alone, leave with friends." },
  poster: { headline: "Ghibli and Lo-fi", subline: "A weekly night for film fans." },
  trivia: [
    { q: "Who directed Spirited Away?", a: "Hayao Miyazaki", source: "anchor" },
    { q: "Which of these would you recommend first?", a: "Your call", source: "c9" },
  ],
});

describe("kit schema", () => {
  it("accepts a complete answer and rejects a short run of show", () => {
    expect(rawKitSchema.safeParse(goodRaw()).success).toBe(true);
    expect(rawKitSchema.safeParse({ ...goodRaw(), runOfShow: goodRaw().runOfShow.slice(0, 2) }).success).toBe(false);
  });
});

describe("resolveKit", () => {
  it("sorts the run of show, drops steps after the end, and says so", () => {
    const { kit, notes } = resolveKit(goodRaw(), ctx, pool, "llm");
    expect(kit.runOfShow.map((s) => s.minute)).toEqual([0, 15, 40]);
    expect(notes.join(" ")).toContain("Dropped 1 run-of-show step");
  });

  it("keeps trivia sources that point at the club and removes unknown ones", () => {
    const { kit, notes } = resolveKit(goodRaw(), ctx, pool, "llm");
    expect(kit.trivia[0].sourceRefId).toBe("fx_movie_1");
    expect(kit.trivia[1]).not.toHaveProperty("sourceRefId");
    expect(notes.join(" ")).toContain('unknown trivia source "c9"');
    expect(kit.triviaNote).toBe("Check before use");
  });

  it("sets the night, the footer and the format from the club, not from the model", () => {
    const { kit } = resolveKit(goodRaw(), ctx, pool, "llm");
    expect(kit.night).toBe("Tuesdays, 7:30 pm");
    expect(kit.poster.footer).toBe(KIT_FOOTER);
    expect(kit.format).toBe("discussion_club");
  });

  it("removes dashes and trims the hook to 110 characters", () => {
    const dash = String.fromCharCode(0x2014);
    const raw = { ...goodRaw(), hook: `A weekly night ${dash} for people who love ${"really ".repeat(30)}good films`, nameTagPrompt: `Ask me ${dash} anything` };
    const { kit } = resolveKit(raw, ctx, pool, "llm");
    expect(kit.hook.length).toBeLessThanOrEqual(110);
    expect(kit.nameTagPrompt).toBe("Ask me , anything");
    expect(JSON.stringify(kit)).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });

  it("trims a long host script to 180 words", () => {
    const { kit, notes } = resolveKit({ ...goodRaw(), hostScript: Array.from({ length: 250 }, (_, i) => `word${i}`).join(" ").slice(0, 1600) }, ctx, pool, "llm");
    expect(kit.hostScript.split(" ").length).toBeLessThanOrEqual(180);
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("playlist", () => {
  it("is chosen from the pool by shared tags first, then affinity", () => {
    const list = pickPlaylist(pool, [anchor, companions[0]]);
    expect(list.map((p) => p.name)).toEqual(["Nujabes", "Joe Hisaishi", "Metallica", "Tycho"]);
    for (const item of list) expect(pool.some((s) => s.refId === item.refId)).toBe(true);
  });

  it("is empty when the pool has no artists, and never repeats a name", () => {
    expect(pickPlaylist([signal("a", "Movie", { domain: "movie" })], [anchor])).toEqual([]);
    const twice = pickPlaylist([signal("a", "Same"), signal("b", "same")], []);
    expect(twice).toHaveLength(1);
  });

  it("ignores anything the model says about music", () => {
    const { kit } = resolveKit(goodRaw(), ctx, pool, "llm");
    expect(kit.playlist.every((p) => pool.some((s) => s.refId === p.refId))).toBe(true);
  });
});

describe("licence note", () => {
  const base = (text: string): Parameters<typeof licenceNoteFor>[0] => ({
    clubName: "Club",
    hook: text,
    runOfShow: [],
    hostScript: "Hello",
    listing: { title: "t", short: "s", long: "l", instagram: "i" },
    poster: { headline: "h", subline: "s" },
    format: "discussion_club",
  });

  it("is added when a text mentions screening a film", () => {
    expect(licenceNoteFor(base("Join our Friday film night"))).toBe(LICENCE_NOTE);
    expect(licenceNoteFor(base("We are screening Spirited Away"))).toBe(LICENCE_NOTE);
    expect(licenceNoteFor(base("We will play the full movie"))).toBe(LICENCE_NOTE);
  });

  it("is not added for a plain discussion night", () => {
    expect(licenceNoteFor(base("Talk about your favourite scenes"))).toBeUndefined();
  });

  it("is attached to the kit when the model's words mention a screening", () => {
    const raw = goodRaw();
    raw.runOfShow[1] = { minute: 15, title: "Screening", detail: "Start the screening on the projector." };
    expect(resolveKit(raw, ctx, pool, "llm").kit.licenceNote).toBe(LICENCE_NOTE);
    expect(resolveKit(goodRaw(), ctx, pool, "llm").kit.licenceNote).toBeUndefined();
  });
});

describe("fallback kit", () => {
  it("is a valid kit for every venue type and night, with no model", () => {
    for (const venueType of ["cafe", "bookstore", "bar", "brewery", "restaurant", "music_venue", "community_space"]) {
      const raw = standardRawKit({ ...ctx, venueType });
      expect(rawKitSchema.safeParse(raw).success, venueType).toBe(true);
      const { kit } = resolveKit(raw, { ...ctx, venueType }, pool, "fallback");
      expect(kit.source).toBe("fallback");
      expect(kit.runOfShow.length).toBeGreaterThanOrEqual(4);
      expect(kit.licenceNote).toBeUndefined();
    }
  });

  it("names the night and falls back to weeknights when it is unknown", () => {
    expect(nightLabel("monday")).toBe("Mondays, 7:30 pm");
    expect(nightLabel(null)).toBe("Weeknights, 7:30 pm");
  });
});

describe("prompts", () => {
  it("send only the club and venue facts, with aliases for trivia sources", () => {
    const prompt = producerPrompt(ctx);
    expect(prompt).toContain("anchor: Spirited Away (movie)");
    expect(prompt).toContain("c1: Nujabes (artist)");
    expect(prompt).toContain("c2: Tonkotsu Alley (place)");
    expect(PRODUCER_SYSTEM).toMatch(/Never plan to screen a full film/);
  });
});

describe("produceKit", () => {
  function setup(existing: ClubKit | null = null) {
    const saved: ClubKit[] = [];
    let asked = 0;
    const produce = createProduceKit({
      loadClub: async (id) => (id === "club-1" ? { runId: "run-1", context: ctx, pool, kit: existing } : null),
      saveKit: async (_id, kit) => {
        saved.push(kit);
      },
      generateStructured: (async (_schema: unknown, _prompt: string, opts: { mock: () => unknown; fallback: () => unknown; cacheKey: string }) => {
        asked += 1;
        return { output: opts.fallback(), source: "fallback" as const, cacheKey: opts.cacheKey };
      }) as never,
    });
    return { produce, saved, asked: () => asked };
  }

  it("writes and saves a kit, labelled with where the words came from", async () => {
    const { produce, saved } = setup();
    const result = await produce("club-1");
    expect(result?.created).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].source).toBe("fallback");
  });

  it("does not ask the model again when the club already has a kit", async () => {
    const first = setup();
    const kit = (await first.produce("club-1"))!.kit;
    const again = setup(kit);
    const result = await again.produce("club-1");
    expect(result).toMatchObject({ created: false });
    expect(again.asked()).toBe(0);
    expect(again.saved).toEqual([]);
  });

  it("returns null for a club that does not exist", async () => {
    expect(await setup().produce("nope")).toBeNull();
  });
});

describe("check-in codes", () => {
  it("are 8 characters from an alphabet without look-alikes", () => {
    for (const bad of "01OILU") expect(CODE_ALPHABET).not.toContain(bad);
    const code = generateCheckInCode();
    expect(code).toHaveLength(CODE_LENGTH);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });

  it("are not the same twice in a row", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCheckInCode()));
    expect(codes.size).toBe(200);
  });

  it("are read back ignoring case, spaces and dashes", () => {
    expect(normaliseCode("ab3k-9xz2")).toBe("AB3K9XZ2");
    expect(normaliseCode(" ab3k 9xz2 ")).toBe("AB3K9XZ2");
  });
});

describe("nextOccurrence", () => {
  it("finds the next slow night, counting today", () => {
    expect(nextOccurrence("tuesday", "2026-10-27")).toBe("2026-10-27");
    expect(nextOccurrence("wednesday", "2026-10-27")).toBe("2026-10-28");
    expect(nextOccurrence("monday", "2026-10-27")).toBe("2026-11-02");
    expect(nextOccurrence("sunday", "2026-10-27")).toBe("2026-11-01");
  });

  it("crosses month and year ends", () => {
    expect(nextOccurrence("friday", "2026-12-30")).toBe("2027-01-01");
  });
});
