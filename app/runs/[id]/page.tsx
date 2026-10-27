import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { getRunState } from "@/src/runs/state";
import { getVenueProgress } from "@/src/progress/progress";
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
  const progress = await getVenueProgress(getDb(), { runId: id });
  if (!progress) notFound();
  return (
    <VenueShell progress={progress} current="read">
      <RunView initial={state} replay={replay === "1" && state.run.status === "done"} />
    </VenueShell>
  );
}
