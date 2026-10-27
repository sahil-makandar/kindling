import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Schema follows docs/PRODUCT_SPEC.md section 7, plus geocode_cache (BUILD_PLAN F4).
// Short fixed vocabularies are plain text columns typed with a union, which keeps
// migrations simple (no Postgres enums to alter).

export const RUN_STAGES = ["locate", "scout", "design", "verify", "baseline", "done"] as const;
export type RunStage = (typeof RUN_STAGES)[number];

export const RUN_STATUSES = ["pending", "running", "done", "error"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TRACE_LEVELS = ["info", "warn", "error"] as const;
export type TraceLevel = (typeof TRACE_LEVELS)[number];

export const QLOO_MODES = ["fixtures", "live", "record"] as const;

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const venues = pgTable("venues", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  venueType: text("venue_type").notNull(),
  slowNight: text("slow_night").notNull(),
  baselineHeadcount: integer("baseline_headcount"),
  qlooEntityId: text("qloo_entity_id"),
  qlooEntityName: text("qloo_entity_name"),
  // The venue's own tags on Qloo, saved by the Locator.
  qlooTags: jsonb("qloo_tags"),
  isDemo: boolean("is_demo").default(false).notNull(),
  createdAt: createdAt(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    status: text("status").$type<RunStatus>().default("pending").notNull(),
    stage: text("stage").$type<RunStage>().default("locate").notNull(),
    radiusM: integer("radius_m"),
    qlooMode: text("qloo_mode").$type<(typeof QLOO_MODES)[number]>().notNull(),
    qlooCallCount: integer("qloo_call_count").default(0).notNull(),
    llmCallCount: integer("llm_call_count").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    // Set while a stage is running. A stage that never finishes can be reclaimed after a timeout.
    stageStartedAt: timestamp("stage_started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("runs_venue_idx").on(t.venueId)],
);

export const traceEvents = pgTable(
  "trace_events",
  {
    // Increasing id doubles as the cursor for "events since" polling.
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stage: text("stage").$type<RunStage>().notNull(),
    level: text("level").$type<TraceLevel>().default("info").notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("trace_events_run_idx").on(t.runId, t.id)],
);

export const qlooCalls = pgTable(
  "qloo_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Null for calls made outside an agent run, such as check-in lookups.
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    endpoint: text("endpoint").notNull(),
    params: jsonb("params").notNull(),
    status: integer("status").notNull(),
    ms: integer("ms").notNull(),
    resultCount: integer("result_count"),
    cached: boolean("cached").default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("qloo_calls_run_idx").on(t.runId)],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    // Qloo entity id or tag id. Unique per run: duplicates keep the highest affinity.
    refId: text("ref_id").notNull(),
    kind: text("kind").$type<"entity" | "tag">().notNull(),
    domain: text("domain"),
    source: text("source"),
    name: text("name").notNull(),
    affinity: doublePrecision("affinity"),
    popularity: doublePrecision("popularity"),
    tags: jsonb("tags"),
    // Where else this signal showed up (area, venue crowd, trend, nearby places), each with its own
    // affinity, rank and Qloo call. The Verifier reads the trend rank and venue-crowd affinity from here.
    appearances: jsonb("appearances"),
    qlooCallId: uuid("qloo_call_id").references(() => qlooCalls.id, { onDelete: "set null" }),
  },
  (t) => [unique("signals_run_ref_unique").on(t.runId, t.refId), index("signals_run_idx").on(t.runId)],
);

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    anchor: jsonb("anchor").notNull(),
    companions: jsonb("companions").notNull(),
    format: text("format").notNull(),
    why: text("why").notNull(),
    score: doublePrecision("score"),
    breakdown: jsonb("breakdown"),
    rank: integer("rank"),
    verified: boolean("verified").default(false).notNull(),
  },
  (t) => [index("candidates_run_idx").on(t.runId)],
);

// One row per cached language model answer, so re-opening a run never calls the model again.
export const llmOutputs = pgTable(
  "llm_outputs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    // Which question this answers, for example "design" or "baseline".
    cacheKey: text("cache_key").notNull(),
    output: jsonb("output").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("llm_outputs_run_key_unique").on(t.runId, t.cacheKey)],
);

export const baselines = pgTable("baselines", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .unique()
    .references(() => runs.id, { onDelete: "cascade" }),
  ideas: jsonb("ideas").notNull(),
  verdict: text("verdict"),
  createdAt: createdAt(),
});

export const clubs = pgTable(
  "clubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    kit: jsonb("kit"),
    status: text("status").$type<"active" | "paused">().default("active").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("clubs_venue_idx").on(t.venueId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    variant: jsonb("variant"),
    checkInCode: text("check_in_code").notNull().unique(),
    status: text("status").$type<"open" | "closed">().default("open").notNull(),
    headcountManual: integer("headcount_manual"),
    vibeRating: integer("vibe_rating"),
    simulated: boolean("simulated").default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("sessions_club_number_unique").on(t.clubId, t.number)],
);

export const attendees = pgTable("attendees", {
  id: uuid("id").defaultRandom().primaryKey(),
  // First name or nickname only. No email, no phone.
  nickname: text("nickname").notNull(),
  // First-party cookie value, stored only after the attendee ticks the consent box.
  deviceToken: text("device_token").unique(),
  simulated: boolean("simulated").default(false).notNull(),
  createdAt: createdAt(),
});

export const checkins = pgTable(
  "checkins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    // Cascade so "Forget me" removes the attendee's check-ins with them.
    attendeeId: uuid("attendee_id")
      .notNull()
      .references(() => attendees.id, { onDelete: "cascade" }),
    favourites: jsonb("favourites").notNull(),
    tagVector: jsonb("tag_vector"),
    consentSeating: boolean("consent_seating").default(true).notNull(),
    tableNo: integer("table_no"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("checkins_session_attendee_unique").on(t.sessionId, t.attendeeId),
    index("checkins_session_idx").on(t.sessionId),
  ],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "cascade" }),
    afterSessionId: uuid("after_session_id").references(() => sessions.id, { onDelete: "set null" }),
    decision: text("decision").$type<"keep" | "tweak" | "switch">().notNull(),
    signals: jsonb("signals"),
    proposal: jsonb("proposal"),
    rationale: text("rationale").notNull(),
    status: text("status").$type<"proposed" | "accepted" | "edited" | "rejected">().default("proposed").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("recommendations_club_idx").on(t.clubId)],
);

export const qlooCache = pgTable("qloo_cache", {
  key: text("key").primaryKey(),
  response: jsonb("response").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const geocodeCache = pgTable("geocode_cache", {
  key: text("key").primaryKey(),
  response: jsonb("response").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
