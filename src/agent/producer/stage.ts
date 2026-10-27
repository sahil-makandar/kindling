import type { Llm } from "../llm";
import { PRODUCER_SYSTEM, producerPrompt } from "../prompts/producer";
import type { PoolSignal } from "../scout/pool";
import { rawKitSchema, resolveKit, standardRawKit, type ClubKit, type KitContext } from "./kit";

// The Producer: writes the kit for a chosen club. One structured model call (main tier) cached per club, with the
// template kit as the fallback so a busy model never leaves a club empty-handed.

export type ProducerDeps = {
  // The club and everything the kit needs, or null when there is no such club.
  loadClub(clubId: string): Promise<{ runId: string; context: KitContext; pool: PoolSignal[]; kit: ClubKit | null } | null>;
  saveKit(clubId: string, kit: ClubKit): Promise<void>;
  generateStructured: Llm["generateStructured"];
};

export type ProduceResult = { kit: ClubKit; created: boolean; notes: string[] };

export function createProduceKit(deps: ProducerDeps) {
  return async function produceKit(clubId: string): Promise<ProduceResult | null> {
    const club = await deps.loadClub(clubId);
    if (!club) return null;
    // A kit is written once. Re-opening the page never asks the model again.
    if (club.kit) return { kit: club.kit, created: false, notes: [] };

    const { context, pool } = club;
    const result = await deps.generateStructured(rawKitSchema, producerPrompt(context), {
      runId: club.runId,
      cacheKey: `kit:${clubId}`,
      tier: "main",
      system: PRODUCER_SYSTEM,
      maxOutputTokens: 3500,
      fallback: () => standardRawKit(context),
      mock: () => standardRawKit(context),
    });

    const { kit, notes } = resolveKit(result.output, context, pool, result.source === "cache" ? "llm" : result.source);
    await deps.saveKit(clubId, kit);
    return { kit, created: true, notes };
  };
}
