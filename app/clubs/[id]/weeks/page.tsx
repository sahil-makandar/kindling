import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getWeeklyView } from "@/src/coach/view";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { getJourney } from "@/src/journey/journey";
import { VenueShell } from "@/src/ui/VenueShell";
import { WeeklyReport } from "@/src/ui/WeeklyView";

export const metadata: Metadata = { title: "Weekly report" };

export const dynamic = "force-dynamic";

export default async function WeeklyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireUuid(id, "club");
  } catch {
    notFound();
  }
  const data = await getWeeklyView(getDb(), id);
  if (!data) notFound();
  const journey = await getJourney(getDb(), { clubId: id });
  if (!journey) notFound();
  return (
    <VenueShell journey={journey} current="grow">
      <WeeklyReport data={data} />
    </VenueShell>
  );
}
