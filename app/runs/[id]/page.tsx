import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { getRunState } from "@/src/runs/state";
import { getJourney } from "@/src/journey/journey";
import { VenueShell } from "@/src/ui/VenueShell";
import { RunView } from "@/src/ui/RunView";

export const metadata: Metadata = { title: "Reading the neighbourhood" };

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ replay?: string }> }) {
  const { id } = await params;
  const { replay } = await searchParams;
  try {
    requireUuid(id);
  } catch {
    notFound();
  }
  const state = await getRunState(getDb(), id);
  if (!state) notFound();
  const journey = await getJourney(getDb(), { runId: id });
  if (!journey) notFound();
  return (
    <VenueShell journey={journey} current="read">
      <RunView initial={state} replay={replay === "1" && state.run.status === "done"} />
    </VenueShell>
  );
}
