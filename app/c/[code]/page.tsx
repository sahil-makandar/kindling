import { cookies } from "next/headers";
import { normaliseCode } from "@/src/clubs/sessions";
import { DEVICE_COOKIE } from "@/src/checkin/cookie";
import { createDbCheckInRepo, findReturning } from "@/src/checkin/repo";
import { getDb } from "@/src/db/client";
import { Button } from "@/src/ui/Button";
import { CheckInFlow } from "@/src/ui/CheckInFlow";
import { EmptyState } from "@/src/ui/EmptyState";

export const dynamic = "force-dynamic";

export default async function CheckInPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = getDb();
  const session = await createDbCheckInRepo(db).loadSession(normaliseCode(decodeURIComponent(code)));

  if (!session) {
    return (
      <div className="mx-auto max-w-md py-8">
        <EmptyState title="We could not find that night" action={<Button href="/">Go to the start</Button>}>
          The check-in code does not match any session. Scan the poster again, or ask the host for the right code.
        </EmptyState>
      </div>
    );
  }
  if (session.status === "closed") {
    return (
      <div className="mx-auto max-w-md py-8">
        <EmptyState title="Tonight's session is closed">Check-in for {session.clubTitle} has finished. Come back next week and bring a friend.</EmptyState>
      </div>
    );
  }

  const token = (await cookies()).get(DEVICE_COOKIE)?.value;
  const returning = token && /^[0-9a-f-]{36}$/i.test(token) ? await findReturning(db, token) : null;
  return <CheckInFlow code={normaliseCode(decodeURIComponent(code))} clubTitle={session.clubTitle} venueName={session.venueName} date={session.date} returningName={returning?.nickname ?? null} />;
}
