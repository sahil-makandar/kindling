import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { COLORS } from "@/src/config/brand";
import { getDb } from "@/src/db/client";
import { originFromHeaders } from "@/src/clubs/origin";
import { getClub } from "@/src/clubs/state";
import { requireUuid } from "@/src/runs/http";
import { ClubKitView } from "@/src/ui/ClubKitView";
import { KitLoader } from "@/src/ui/KitLoader";

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
  if (!club.kit) return <KitLoader clubId={club.id} title={club.title} />;

  const session = club.sessions[0] ?? null;
  const checkInUrl = session ? `${originFromHeaders(await headers())}/c/${session.checkInCode}` : null;
  const qr = checkInUrl ? await QRCode.toDataURL(checkInUrl, { margin: 1, width: 640, errorCorrectionLevel: "M", color: { dark: COLORS.ink, light: COLORS.card } }) : "";
  return <ClubKitView club={club} kit={club.kit} qr={qr} checkInUrl={checkInUrl ? new URL(checkInUrl).pathname : null} />;
}
