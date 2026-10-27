import { ImageResponse } from "next/og";
import { APP_NAME, COLORS, TAGLINE } from "@/src/config/brand";

export const alt = `${APP_NAME}: ${TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The picture shown when a link is shared: the name and tagline on a noticeboard-coloured card with a marigold tape strip.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: COLORS.paper, color: COLORS.ink, position: "relative" }}>
        <div style={{ position: "absolute", top: 48, right: -40, width: 360, height: 56, background: COLORS.marigold, transform: "rotate(35deg)" }} />
        <div style={{ display: "flex", fontSize: 132, fontWeight: 900, letterSpacing: -2 }}>{APP_NAME}</div>
        <div style={{ display: "flex", marginTop: 16, fontSize: 52, color: COLORS.inkSoft }}>{TAGLINE}</div>
        <div style={{ display: "flex", marginTop: 56, fontSize: 32, borderTop: `4px solid ${COLORS.ink}`, paddingTop: 24 }}>Turn your quietest night into a weekly club, seated by shared taste.</div>
      </div>
    ),
    size,
  );
}
