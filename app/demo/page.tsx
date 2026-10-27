import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/src/db/client";
import { clubs, venues } from "@/src/db/schema";
import { Button } from "@/src/ui/Button";
import { EmptyState } from "@/src/ui/EmptyState";

export const dynamic = "force-dynamic";

// "See a demo venue": goes straight to the fictional demo club's weekly report.
export default async function DemoPage() {
  const [club] = await getDb()
    .select({ id: clubs.id })
    .from(clubs)
    .innerJoin(venues, eq(venues.id, clubs.venueId))
    .where(eq(venues.isDemo, true))
    .orderBy(desc(clubs.createdAt))
    .limit(1);
  if (club) redirect(`/clubs/${club.id}/weeks`);
  return (
    <div className="mx-auto max-w-xl py-8">
      <EmptyState title="The demo venue is not set up yet" action={<Button href="/">Try your own venue</Button>}>
        The demo venue is built once from a script. Until it has been run, you can try the full flow with your own venue or one of the examples on the start page.
      </EmptyState>
    </div>
  );
}
