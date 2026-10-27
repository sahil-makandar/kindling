import { notFound } from "next/navigation";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { getRunState } from "@/src/runs/state";
import { RunView } from "@/src/ui/RunView";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireUuid(id);
  } catch {
    notFound();
  }
  const state = await getRunState(getDb(), id);
  if (!state) notFound();
  return <RunView initial={state} />;
}
