import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { getCandidates } from "@/src/runs/state";
import { getJourney } from "@/src/journey/journey";
import { VenueShell } from "@/src/ui/VenueShell";
import { PicksView } from "@/src/ui/PicksView";

export const metadata: Metadata = { title: "Your hidden clubs" };

export const dynamic = "force-dynamic";

export default async function ClubPicksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireUuid(id);
  } catch {
    notFound();
  }
  const data = await getCandidates(getDb(), id);
  if (!data) notFound();
  const journey = await getJourney(getDb(), { runId: id });
  if (!journey) notFound();
  return (
    <VenueShell journey={journey} current="pick">
      <PicksView data={data} />
    </VenueShell>
  );
}
