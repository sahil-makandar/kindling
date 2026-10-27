import { notFound } from "next/navigation";
import { getWeeklyView } from "@/src/coach/view";
import { getDb } from "@/src/db/client";
import { requireUuid } from "@/src/runs/http";
import { WeeklyReport } from "@/src/ui/WeeklyView";

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
  return <WeeklyReport data={data} />;
}
