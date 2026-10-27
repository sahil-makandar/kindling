import { QlooError } from "@/src/qloo/errors";
import type { Endpoints } from "@/src/qloo/endpoints";
import type { QlooEntity, QlooTag } from "@/src/qloo/schemas";
import { areaTags, tagsFromEntities } from "@/src/qloo/tags";
import { traceEmptyResult } from "../qlooTrace";
import type { Tracer } from "../trace";
import { compactEntities, compactTags, SignalPool, STRONG_DOMAIN_MIN, strongestLine, type PoolSignal } from "./pool";
import { buildLadder, DOMAIN_LABEL, planFor, TRENDING_DOMAINS, type ScoutDomain } from "./plan";

// The Scout's working state and the actions the model can take. Everything that costs a Qloo call goes
// through here, so the budget, the trace lines and the thin-data rules are the same whether a model picks
// the steps or the deterministic plan does.

export const MAX_QLOO_CALLS = 16;
// The nearby-places scan reads at least this far, in metres.
export const PLACES_RADIUS_M = 1000;
// The last few calls are kept for re-scanning after the radius is widened.
export const RESERVE_FOR_RESCANS = 3;

// Qloo's area favourites are dominated by the biggest names (top results all sit at popularity 0.9 and above, and
// look alike in every neighbourhood). The "local" band caps popularity so the more distinctive picks show up.
export const LOCAL_POPULARITY_MAX = 0.9;
export type Band = "local" | "mainstream";

export type ScoutVenue = {
  name: string;
  venueType: string;
  lat: number;
  lon: number;
  city: string | null;
  qlooEntityId: string | null;
  // The venue's own tags on Qloo (ambience, interests, category...). Empty if the venue is not in Qloo.
  tags: QlooTag[];
};

export type ScoutApi = Pick<Endpoints, "insightsEntities" | "insightsTags" | "getEntities">;

// What a tool hands back to the model: small, and with a plain next-step hint.
export type ToolResult = { ok: boolean; [key: string]: unknown };

// En and em dashes, written as character codes so this file stays free of them.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`, "g");

// Text from a model goes into the trace, so keep it to plain hyphens and end it with a full stop.
function sentence(text: string): string {
  const plain = text.replace(DASHES, "-").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  return plain ? `${plain}.` : "";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export class ScoutRun {
  readonly pool = new SignalPool();
  private readonly ladder: ReturnType<typeof buildLadder>;
  private step = 0;
  private used = 0;
  private finishedFlag = false;
  // The step each action was last done at, to refuse repeats and to spot re-scans after widening.
  private readonly doneAt = new Map<string, number>();
  private readonly thinAt = new Map<string, number>();

  constructor(
    private readonly deps: {
      venue: ScoutVenue;
      api: ScoutApi;
      trace: Tracer;
      runId: string;
      maxCalls?: number;
      // When to stop starting new scans (epoch ms). Agent routes must finish in 60 s.
      deadlineAt?: number;
      now?: () => number;
    },
  ) {
    this.ladder = buildLadder({ lon: deps.venue.lon, lat: deps.venue.lat }, deps.venue.city);
  }

  // ---- state the stage and the plan read ----

  get callsUsed(): number {
    return this.used;
  }
  get maxCalls(): number {
    return this.deps.maxCalls ?? MAX_QLOO_CALLS;
  }
  get callsLeft(): number {
    return this.maxCalls - this.used;
  }
  get radiusM(): number | null {
    return this.ladder[this.step].radiusM;
  }
  get radiusLabel(): string {
    return this.ladder[this.step].label;
  }
  get radiusName(): string {
    return this.ladder[this.step].name;
  }
  get canWiden(): boolean {
    return this.step < this.ladder.length - 1;
  }
  get finished(): boolean {
    return this.finishedFlag;
  }
  get venue(): ScoutVenue {
    return this.deps.venue;
  }
  get ladderLabels(): string[] {
    return this.ladder.map((s) => s.label);
  }

  // The model finishing ends the model's own tool calls. The stage then fills in the rest of the standard plan, which is
  // not the model's call, so it reopens the Scout first.
  resume(): void {
    this.finishedFlag = false;
  }

  // True once the time limit has passed: nothing new is started, and finishing is allowed.
  get timeUp(): boolean {
    return this.deps.deadlineAt !== undefined && (this.deps.now ?? Date.now)() > this.deps.deadlineAt;
  }

  // A model may ask for several tools in one step and the SDK runs them together. Running them one after
  // another keeps the budget and the repeat checks honest.
  private queue: Promise<unknown> = Promise.resolve();
  serial<T>(action: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(action, action);
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  has(action: string, domain?: string): boolean {
    return this.doneAt.has(this.key(action, domain));
  }

  // Has this domain been read for the area, in either band?
  hasArea(domain: string): boolean {
    return this.has("area-local", domain) || this.has("area-mainstream", domain);
  }

  // Domains whose latest area scan was thin at a narrower radius than the current one.
  staleDomains(): string[] {
    return [...this.thinAt.entries()].filter(([, step]) => step < this.step).map(([domain]) => domain);
  }

  missing(): string[] {
    const missing: string[] = [];
    const strong = this.pool.strongDomains().length;
    if (strong < 4) missing.push(`${4 - strong} more domain${4 - strong === 1 ? "" : "s"} with ${STRONG_DOMAIN_MIN}+ results`);
    if (!this.has("tags")) missing.push("the area's tags");
    const anyTrend = [...this.doneAt.keys()].some((key) => key.startsWith("trend:"));
    if (!anyTrend && !this.has("places")) missing.push("a trend scan or nearby places");
    return missing;
  }

  isEnough(): boolean {
    return this.missing().length === 0;
  }

  // ---- budget and repeat rules ----

  private key(action: string, domain?: string): string {
    return domain ? `${action}:${domain}` : action;
  }

  // Returns a reason to refuse, or null when the action may go ahead.
  private refusal(action: string, domain?: string): string | null {
    if (this.finishedFlag) return "Scouting is already finished.";
    if (this.timeUp) return "Out of time for scouting. Call finish.";
    const previous = this.doneAt.get(this.key(action, domain));
    if (previous === this.step) return "Already done at this radius. Pick something new.";
    if (this.used >= this.maxCalls) return `The budget is spent (${this.used} of ${this.maxCalls} Qloo calls). Call finish.`;
    const isRescan = previous !== undefined;
    if (!isRescan && this.used >= this.maxCalls - RESERVE_FOR_RESCANS) {
      return `Only the last ${RESERVE_FOR_RESCANS} calls are kept for re-scans after widening. Re-scan a thin domain, or call finish.`;
    }
    return null;
  }

  private refuse(message: string): ToolResult {
    return { ok: false, error: message, callsUsed: this.used, callsLeft: this.callsLeft };
  }

  private async spendOn<T>(action: string, domain: string | undefined, calls: number | null, run: () => Promise<T>): Promise<T> {
    this.doneAt.set(this.key(action, domain), this.step);
    // Count the request before it is sent, so a failure still uses budget. Tag lookups report their own count.
    if (calls !== null) this.used += calls;
    return run();
  }

  // Takes the budget and marks the action done before anything is awaited, so scans started together cannot overspend.
  private reserve(action: string, domain: string | undefined, calls: number): void {
    this.doneAt.set(this.key(action, domain), this.step);
    this.used += calls;
  }

  private snapshot(): { callsUsed: number; callsLeft: number } {
    return { callsUsed: this.used, callsLeft: this.callsLeft };
  }

  private entityAsQloo(signal: PoolSignal): QlooEntity {
    return {
      id: signal.refId,
      name: signal.name,
      popularity: signal.popularity,
      affinity: signal.appearances.area?.affinity ?? signal.affinity,
      tags: signal.tags,
      properties: {},
    };
  }

  // A Qloo failure on one call must not end the run: the model is told and can try something else.
  private async guarded(label: string, work: () => Promise<ToolResult>): Promise<ToolResult> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof QlooError)) throw error;
      await this.deps.trace.warn(`Could not read ${label}: ${error.message}`);
      return { ok: false, error: error.message, ...this.snapshot() };
    }
  }

  // ---- the actions ----

  // The venue's own tags, already known from the Locator. Costs no Qloo call.
  async adoptVenueTags(): Promise<void> {
    const tags = this.deps.venue.tags;
    if (tags.length === 0) return;
    this.pool.addTags(tags, { source: "venue", callId: null });
    await this.deps.trace.info(
      `${this.deps.venue.name} on Qloo is tagged: ${tags.slice(0, 8).map((t) => t.name).join(", ")}.`,
      { tags: tags.length },
    );
  }

  async scanArea(domain: ScoutDomain, reason: string, band: Band = "local"): Promise<ToolResult> {
    const action = `area-${band}`;
    const refused = this.refusal(action, domain);
    if (refused) return this.refuse(refused);
    this.reserve(action, domain, 1);
    const label = DOMAIN_LABEL[domain];
    const kind = band === "local" ? "distinctive " : "mainstream ";
    await this.deps.trace.info(`Next: read the area's ${kind}taste in ${label}. ${sentence(reason)}`, {
      tool: "scan_area",
      domain,
      band,
      reason,
    });

    return this.guarded(label, () =>
      (async () => {
        const result = await this.deps.api.insightsEntities(
          {
            domain,
            signalArea: this.ladder[this.step].spec,
            popularityMax: band === "local" ? LOCAL_POPULARITY_MAX : undefined,
            take: 15,
          },
          { purpose: "scout.area_entities", runId: this.deps.runId },
        );
        if (result.empty) await traceEmptyResult(this.deps.trace, `${label} ${this.radiusLabel}`, result);
        this.pool.addEntities(result.items, { domain, source: "area", callId: result.callId });

        const withAffinity = result.items.filter((e) => e.affinity !== undefined).length;
        await this.deps.trace.info(
          `Reading what your city loves in ${label}${band === "local" ? ", beyond the biggest names" : ", the mainstream picks"}... ${plural(result.items.length, "result")} found.${result.items.length ? ` Strongest: ${strongestLine(result.items)}.` : ""}`,
          { domain, band, callId: result.callId, cached: result.cached },
        );

        const thin = withAffinity < STRONG_DOMAIN_MIN;
        if (thin) {
          this.thinAt.set(domain, this.step);
          await this.deps.trace.warn(
            `Qloo has thin data ${this.radiusLabel} for ${label}: only ${plural(withAffinity, "result")} with an affinity.`,
          );
        } else {
          this.thinAt.delete(domain);
        }
        return {
          ok: true,
          domain,
          band,
          radius: this.radiusLabel,
          results: result.items.length,
          thin,
          top: compactEntities(result.items),
          hint: thin
            ? this.canWiden
              ? "Thin. Call widen_radius once, then scan this domain again."
              : "Thin, and already at the widest view. Move on."
            : undefined,
          ...this.snapshot(),
        };
      })(),
    );
  }

  // The vocabulary of the area: Qloo's own tags for the area (the vibe of its places) plus the genres and themes
  // carried by the entities already scanned, which is what describes taste in film, music and books.
  async scanAreaTags(reason: string): Promise<ToolResult> {
    const refused = this.refusal("tags");
    if (refused) return this.refuse(refused);
    await this.deps.trace.info(`Next: read the area's tag vocabulary. ${sentence(reason)}`, { tool: "scan_area_tags", reason });

    return this.guarded("the area's tags", () =>
      this.spendOn("tags", undefined, null, async () => {
        const areaEntities = this.pool
          .entities()
          .filter((s) => s.appearances.area && s.domain !== "place")
          .map((s) => this.entityAsQloo(s));
        const result = await areaTags(
          this.deps.api,
          { area: this.ladder[this.step].spec, areaEntities, take: 30 },
          { purpose: "scout.area_tags", runId: this.deps.runId },
        );
        this.used += result.qlooCalls;
        this.pool.addTags(result.tags, { source: "area", callId: result.callId });
        if (result.fallbackReason) await this.deps.trace.info(result.fallbackReason);

        const derived = result.source === "qloo_tags" ? tagsFromEntities(areaEntities, "affinity", 20) : [];
        this.pool.addTags(derived, { source: "area", callId: null });

        if (result.tags.length === 0 && derived.length === 0) {
          await this.deps.trace.warn("No tags were available for this area.");
        } else {
          if (result.tags.length > 0) {
            await this.deps.trace.info(
              `Reading the area's tag vocabulary... ${plural(result.tags.length, "tag")}. Top: ${strongestLine(result.tags)}.`,
              { source: result.source, callId: result.callId },
            );
          }
          if (derived.length > 0) {
            await this.deps.trace.info(
              `Genres and themes carried by what the area loves: ${strongestLine(derived, 5)}.`,
            );
          }
        }
        return {
          ok: true,
          source: result.source,
          tags: compactTags(result.tags),
          genresAndThemes: compactTags(derived, 6),
          ...this.snapshot(),
        };
      }),
    );
  }

  // Venues like this one near it. Qloo cannot read a venue's crowd for films or music (a place is not a valid
  // taste signal there), but it can find similar places, which shows the scene the venue competes and
  // collaborates with.
  async scanSimilarVenues(reason: string): Promise<ToolResult> {
    const venueId = this.deps.venue.qlooEntityId;
    if (!venueId) {
      return this.refuse("The venue is not in Qloo, so there is nothing to compare it with. Skip this and read the area instead.");
    }
    const refused = this.refusal("similar");
    if (refused) return this.refuse(refused);
    await this.deps.trace.info(`Next: find venues like ${this.deps.venue.name} nearby. ${sentence(reason)}`, {
      tool: "scan_similar_venues",
      reason,
    });

    return this.guarded("similar venues", () =>
      this.spendOn("similar", undefined, 1, async () => {
        const result = await this.deps.api.insightsEntities(
          { domain: "place", signalEntities: [venueId], filterArea: this.ladder[this.step].spec, take: 12 },
          { purpose: "scout.similar_venues", runId: this.deps.runId },
        );
        if (result.empty) await traceEmptyResult(this.deps.trace, `venues like ${this.deps.venue.name}`, result);
        const others = result.items.filter((p) => p.id !== venueId);
        this.pool.addEntities(others, { domain: "place", source: "venue", callId: result.callId });
        const names = others.slice(0, 4).map((p) => p.name).join(", ");
        await this.deps.trace.info(
          `Looking for venues like ${this.deps.venue.name}... ${plural(others.length, "venue")}${names ? `: ${names}` : ""}.`,
          { callId: result.callId },
        );
        return { ok: true, results: others.length, venues: compactEntities(others, 8), ...this.snapshot() };
      }),
    );
  }

  async scanTrending(domain: ScoutDomain, reason: string): Promise<ToolResult> {
    if (!TRENDING_DOMAINS.includes(domain)) {
      return this.refuse(`Qloo does not support trends for ${DOMAIN_LABEL[domain]} yet. Try film, music, TV or podcasts.`);
    }
    const refused = this.refusal("trend", domain);
    if (refused) return this.refuse(refused);
    this.reserve("trend", domain, 1);
    const label = DOMAIN_LABEL[domain];
    await this.deps.trace.info(`Next: check what is rising in ${label}. ${sentence(reason)}`, { tool: "scan_trending", domain, reason });

    return this.guarded(`trends in ${label}`, () =>
      (async () => {
        const result = await this.deps.api.insightsEntities(
          {
            domain,
            signalArea: this.ladder[this.step].spec,
            trending: true,
            popularityMax: LOCAL_POPULARITY_MAX,
            take: 15,
          },
          { purpose: "scout.trending", runId: this.deps.runId },
        );
        if (result.empty) await traceEmptyResult(this.deps.trace, `trends in ${label} ${this.radiusLabel}`, result);
        this.pool.addEntities(result.items, { domain, source: "trend", callId: result.callId });
        await this.deps.trace.info(
          `Checking what is rising in ${label} ${this.radiusLabel}... ${plural(result.items.length, "result")}.${result.items.length ? ` Rising: ${strongestLine(result.items)}.` : ""}`,
          { domain, callId: result.callId },
        );
        return { ok: true, domain, results: result.items.length, rising: compactEntities(result.items, 5), ...this.snapshot() };
      })(),
    );
  }

  async scanNearbyPlaces(reason: string): Promise<ToolResult> {
    const refused = this.refusal("places");
    if (refused) return this.refuse(refused);
    await this.deps.trace.info(`Next: look at the food and venue scene nearby. ${sentence(reason)}`, { tool: "scan_nearby_places", reason });

    return this.guarded("nearby places", () =>
      this.spendOn("places", undefined, 1, async () => {
        // Places are the truly local signal, so they are always read within 1 km, even when the media scans stayed closer.
        const current = this.ladder[this.step].spec;
        const spec = "radiusM" in current && current.radiusM < PLACES_RADIUS_M ? { ...current, radiusM: PLACES_RADIUS_M } : current;
        const result = await this.deps.api.insightsEntities(
          { domain: "place", signalArea: spec, filterArea: spec, take: 20 },
          { purpose: "scout.places", runId: this.deps.runId },
        );
        if (result.empty) await traceEmptyResult(this.deps.trace, `nearby places ${this.radiusLabel}`, result);
        this.pool.addEntities(result.items, { domain: "place", source: "places", callId: result.callId });
        const names = result.items.slice(0, 4).map((p) => p.name).join(", ");
        await this.deps.trace.info(
          `Looking at the places within 1 km of your door... ${plural(result.items.length, "place")}${names ? `: ${names}` : ""}.`,
          { callId: result.callId },
        );
        return { ok: true, results: result.items.length, places: compactEntities(result.items, 8), ...this.snapshot() };
      }),
    );
  }

  async widenRadius(reason: string): Promise<ToolResult> {
    if (this.finishedFlag) return this.refuse("Scouting is already finished.");
    if (this.timeUp) return this.refuse("Out of time for scouting. Call finish.");
    if (!this.canWiden) return this.refuse("Already at the widest view.");
    const from = this.radiusLabel;
    this.step += 1;
    await this.deps.trace.info(`Qloo has thin data ${from}, widening to ${this.radiusName}. ${sentence(reason)}`, {
      tool: "widen_radius",
      reason,
      radiusM: this.radiusM,
    });
    return {
      ok: true,
      radius: this.radiusLabel,
      stale: this.staleDomains(),
      hint: this.staleDomains().length ? "Scan the thin domains again at this radius." : undefined,
      ...this.snapshot(),
    };
  }

  // The model says it is done. Refused until the pool is strong enough, unless the budget is gone.
  async finish(summary: string): Promise<ToolResult> {
    const missing = this.missing();
    if (missing.length > 0 && this.callsLeft > 0 && !this.timeUp) {
      return this.refuse(`Not enough yet. Still missing: ${missing.join("; ")}. Keep scouting.`);
    }
    this.finishedFlag = true;
    await this.deps.trace.info(`Scout summary: ${sentence(summary)}`, { tool: "finish" });
    return { ok: true, ...this.snapshot() };
  }
}

// What the standard plan would still do. Empty once the plan is complete, so the stage can tell people what it is
// adding after a model has chosen its own steps.
export function planGaps(scout: ScoutRun): string[] {
  const gaps: string[] = [];
  const domains = planFor(scout.venue.venueType);
  const missingDomains = domains.filter((d) => !scout.hasArea(d));
  if (missingDomains.length > 0) gaps.push(`${missingDomains.map((d) => DOMAIN_LABEL[d]).join(", ")} for the area`);
  if (!scout.has("places")) gaps.push("nearby places");
  const strong = domains.filter((d) => scout.pool.areaEntities(d).length >= STRONG_DOMAIN_MIN);
  if (strong.filter((d) => TRENDING_DOMAINS.includes(d)).slice(0, 2).some((d) => !scout.has("trend", d))) gaps.push("what is rising");
  if (scout.venue.qlooEntityId && !scout.has("similar")) gaps.push("venues like yours");
  if (!scout.has("tags")) gaps.push("the area's tags");
  if (strong.slice(0, 2).some((d) => !scout.has("area-mainstream", d))) gaps.push("the mainstream picks");
  return gaps;
}

// The standard plan for the venue type. It runs through the same actions as the model, so the budget and the
// trace are identical, and it skips whatever has already been done. Used when no model can drive the Scout,
// and to top up when a model stops early.
export async function runDeterministicPlan(scout: ScoutRun): Promise<void> {
  const why = `This is the standard plan for a ${scout.venue.venueType.replace("_", " ")}.`;
  const domains = planFor(scout.venue.venueType);
  let widened = false;

  // The first look at each domain does not depend on the others, so they go out together. Pacing to Qloo is the client's job.
  const first = await Promise.all(domains.filter((d) => !scout.hasArea(d) || scout.staleDomains().includes(d)).map((d) => scout.scanArea(d, why)));
  if (first.some((result) => result.ok && result.thin) && scout.canWiden && !widened) {
    widened = true;
    await scout.widenRadius("The first scan came back thin.");
  }
  for (const domain of scout.staleDomains()) {
    await scout.scanArea(domain as ScoutDomain, "Scanning again at the wider radius.");
  }

  const strong = domains.filter((d) => scout.pool.areaEntities(d).length >= STRONG_DOMAIN_MIN);
  // The rest are independent of each other too: what is rising, the places within 1 km, venues like this one, the area's
  // tags, and the mainstream picks for the crowd-pulling anchors the distinctive band leaves out.
  await Promise.all([
    ...strong.filter((d) => TRENDING_DOMAINS.includes(d)).slice(0, 2).filter((d) => !scout.has("trend", d)).map((d) => scout.scanTrending(d, why)),
    ...(scout.has("places") ? [] : [scout.scanNearbyPlaces(why)]),
    ...(scout.venue.qlooEntityId && !scout.has("similar") ? [scout.scanSimilarVenues(why)] : []),
    ...(scout.has("tags") ? [] : [scout.scanAreaTags(why)]),
    ...strong.slice(0, 2).filter((d) => !scout.has("area-mainstream", d)).map((d) => scout.scanArea(d, why, "mainstream")),
  ]);
}
