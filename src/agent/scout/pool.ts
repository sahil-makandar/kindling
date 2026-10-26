import type { QlooEntity, QlooTag } from "@/src/qloo/schemas";

// The signal pool is everything the Scout learned. The Designer only ever sees this pool, so nothing it
// proposes can be invented: every id has to be in here.

export type SignalSource = "area" | "venue" | "trend" | "places";

// One place a signal showed up. Rank is its position in that result list (0 is the strongest).
export type Appearance = { affinity?: number; popularity?: number; rank: number; callId: string | null };

export type PoolSignal = {
  refId: string;
  kind: "entity" | "tag";
  domain: string | null;
  // The source where this signal scored highest. The others are in `appearances`.
  source: SignalSource;
  name: string;
  affinity?: number;
  popularity?: number;
  tags: QlooTag[];
  appearances: Partial<Record<SignalSource, Appearance>>;
  callId: string | null;
};

// How many entities with an affinity a domain needs before we call it a strong signal.
export const STRONG_DOMAIN_MIN = 5;

export class SignalPool {
  private readonly signals = new Map<string, PoolSignal>();

  addEntities(
    entities: QlooEntity[],
    where: { domain: string; source: SignalSource; callId: string | null },
  ): void {
    entities.forEach((entity, rank) => {
      this.add({
        refId: entity.id,
        kind: "entity",
        domain: where.domain,
        name: entity.name,
        affinity: entity.affinity,
        popularity: entity.popularity,
        tags: entity.tags,
        source: where.source,
        appearance: { affinity: entity.affinity, popularity: entity.popularity, rank, callId: where.callId },
      });
    });
  }

  addTags(tags: QlooTag[], where: { source: SignalSource; callId: string | null }): void {
    tags.forEach((tag, rank) => {
      this.add({
        refId: tag.id,
        kind: "tag",
        domain: null,
        name: tag.name,
        affinity: tag.affinity,
        tags: [],
        source: where.source,
        appearance: { affinity: tag.affinity, rank, callId: where.callId },
      });
    });
  }

  // Same id twice: keep the highest affinity, and remember every place it appeared.
  private add(input: {
    refId: string;
    kind: "entity" | "tag";
    domain: string | null;
    name: string;
    affinity?: number;
    popularity?: number;
    tags: QlooTag[];
    source: SignalSource;
    appearance: Appearance;
  }): void {
    const existing = this.signals.get(input.refId);
    if (!existing) {
      this.signals.set(input.refId, {
        refId: input.refId,
        kind: input.kind,
        domain: input.domain,
        source: input.source,
        name: input.name,
        affinity: input.affinity,
        popularity: input.popularity,
        tags: input.tags,
        appearances: { [input.source]: input.appearance },
        callId: input.appearance.callId,
      });
      return;
    }

    // A repeat in the same source (for example after widening the radius) keeps its best showing.
    const previous = existing.appearances[input.source];
    if (!previous || (input.appearance.affinity ?? -1) > (previous.affinity ?? -1)) {
      existing.appearances[input.source] = input.appearance;
    }
    if ((input.affinity ?? -1) > (existing.affinity ?? -1)) {
      existing.affinity = input.affinity;
      existing.source = input.source;
      existing.callId = input.appearance.callId;
    }
    if (existing.popularity === undefined) existing.popularity = input.popularity;
    if (existing.tags.length === 0) existing.tags = input.tags;
  }

  get(refId: string): PoolSignal | undefined {
    return this.signals.get(refId);
  }

  all(): PoolSignal[] {
    return [...this.signals.values()];
  }

  entities(domain?: string): PoolSignal[] {
    return this.all().filter((s) => s.kind === "entity" && (domain === undefined || s.domain === domain));
  }

  tags(): PoolSignal[] {
    return this.all().filter((s) => s.kind === "tag");
  }

  // Entities the area itself loves in one domain, strongest first.
  areaEntities(domain: string): PoolSignal[] {
    return this.entities(domain)
      .filter((s) => s.appearances.area?.affinity !== undefined)
      .sort((a, b) => (b.appearances.area?.affinity ?? 0) - (a.appearances.area?.affinity ?? 0));
  }

  // Domains where the area gave enough results with an affinity to count as a real signal.
  strongDomains(): string[] {
    const domains = new Set(this.entities().map((s) => s.domain).filter((d): d is string => d !== null && d !== "place"));
    return [...domains].filter((d) => this.areaEntities(d).length >= STRONG_DOMAIN_MIN);
  }

  // Every domain that gave at least one result, strong or not.
  domains(): string[] {
    return [...new Set(this.entities().map((s) => s.domain).filter((d): d is string => d !== null && d !== "place"))];
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// What the model sees about a scan: just enough to choose its next step, to keep prompts small.
export function compactEntities(entities: QlooEntity[], limit = 6) {
  return entities.slice(0, limit).map((e) => ({
    id: e.id,
    name: e.name,
    affinity: e.affinity === undefined ? null : round2(e.affinity),
    tags: e.tags.slice(0, 3).map((t) => t.name),
  }));
}

export function compactTags(tags: QlooTag[], limit = 8) {
  return tags.slice(0, limit).map((t) => ({ name: t.name, affinity: t.affinity === undefined ? null : round2(t.affinity) }));
}

// "Piranesi (0.91), Circe (0.88)" for the trace.
export function strongestLine(items: Array<{ name: string; affinity?: number }>, limit = 3): string {
  return items
    .slice(0, limit)
    .map((i) => (i.affinity === undefined ? i.name : `${i.name} (${round2(i.affinity)})`))
    .join(", ");
}
