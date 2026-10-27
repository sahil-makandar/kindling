import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { getCandidates } from "@/src/runs/state";
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
  return <PicksView data={data} />;
}
