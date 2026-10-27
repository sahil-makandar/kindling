import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { COLORS } from "@/src/config/brand";
import { getDb } from "@/src/db/client";
import { loadBoard } from "@/src/checkin/repo";
import { originFromHeaders } from "@/src/clubs/origin";
import { getClub } from "@/src/clubs/state";
import { requireUuid } from "@/src/runs/http";
import { Button } from "@/src/ui/Button";
import { EmptyState } from "@/src/ui/EmptyState";
import { LiveBoard } from "@/src/ui/LiveBoard";

export const metadata: Metadata = { title: "Live night" };

export const dynamic = "force-dynamic";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireUuid(id, "club");
  } catch {
    notFound();
  }
  const db = getDb();
  const club = await getClub(db, id);
  if (!club) notFound();

  // Tonight is the latest open session; if every session is closed, show the latest one.
  const session = [...club.sessions].reverse().find((s) => s.status === "open") ?? club.sessions.at(-1);
  if (!session) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <EmptyState title="No session yet" action={<Button href={`/clubs/${club.id}`}>Open the club kit</Button>}>
          Open the club kit first. It creates the first session and its check-in code.
        </EmptyState>
      </div>
    );
  }
  const board = await loadBoard(db, session.id);
  if (!board) notFound();

  const path = `/c/${session.checkInCode}`;
  const qr = await QRCode.toDataURL(`${originFromHeaders(await headers())}${path}`, { margin: 1, width: 320, errorCorrectionLevel: "M", color: { dark: COLORS.ink, light: COLORS.card } });
  return <LiveBoard clubId={club.id} clubTitle={club.title} initial={board} qr={qr} checkInPath={path} />;
}
