import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { COLORS } from "@/src/config/brand";
import { getDb } from "@/src/db/client";
import { originFromHeaders } from "@/src/clubs/origin";
import { getClub } from "@/src/clubs/state";
import { requireUuid } from "@/src/runs/http";
import { ClubKitView } from "@/src/ui/ClubKitView";
import { getJourney } from "@/src/journey/journey";
import { VenueShell } from "@/src/ui/VenueShell";
import { KitLoader } from "@/src/ui/KitLoader";

export const metadata: Metadata = { title: "Club kit" };

export const dynamic = "force-dynamic";

export default async function ClubKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    requireUuid(id, "club");
  } catch {
    notFound();
  }
  const club = await getClub(getDb(), id);
  if (!club) notFound();
  const journey = await getJourney(getDb(), { clubId: id });
  if (!journey) notFound();
  if (!club.kit) {
    return (
      <VenueShell journey={journey} current="kit">
        <KitLoader clubId={club.id} title={club.title} />
      </VenueShell>
    );
  }

  // The poster's QR opens the coming night: the latest open session, or the latest one if all are closed.
  const session = [...club.sessions].reverse().find((s) => s.status === "open") ?? club.sessions.at(-1) ?? null;
  const checkInUrl = session ? `${originFromHeaders(await headers())}/c/${session.checkInCode}` : null;
  const qr = checkInUrl ? await QRCode.toDataURL(checkInUrl, { margin: 1, width: 640, errorCorrectionLevel: "M", color: { dark: COLORS.ink, light: COLORS.card } }) : "";
  return (
    <VenueShell journey={journey} current="kit">
      <ClubKitView club={club} kit={club.kit} qr={qr} checkInUrl={checkInUrl ? new URL(checkInUrl).pathname : null} />
    </VenueShell>
  );
}
