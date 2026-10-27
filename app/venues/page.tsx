import type { Metadata } from "next";
import { Button } from "@/src/ui/Button";
import { PageIntro } from "@/src/ui/PageIntro";
import { YourVenues } from "@/src/ui/YourVenues";

export const metadata: Metadata = { title: "Your venues" };

export default function VenuesPage() {
  return (
    <div>
      <PageIntro title="Your venues" action={<Button href="/#start" variant="cta">Add a venue</Button>}>
        The venues and clubs you have set up on this device. Pick one up where you left it.
      </PageIntro>
      <YourVenues />
      <p className="mt-6 text-sm text-ink-soft">Saved in this browser only. Clearing your browser data clears this list, and the clubs themselves stay reachable by their links.</p>
    </div>
  );
}
