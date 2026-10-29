import type { ClubKit } from "@/src/agent/producer/kit";

// The printable poster . Everything scales with the poster's own width (cqw units), so the
// same markup is the on-screen preview, the printed A4 page and the PNG export.

export function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function singularNight(night: string): string {
  return night.split(",")[0].replace(/s$/, "");
}

export function Poster({
  kit,
  venueName,
  loves,
  firstNight,
  qr,
  posterId = "poster",
}: {
  kit: ClubKit;
  venueName: string;
  loves: string[];
  firstNight: string | null;
  qr: string;
  posterId?: string;
}) {
  const time = kit.night.split(",")[1]?.trim() ?? "";
  return (
    <div className="@container w-full">
      <div id={posterId} data-poster className="relative mx-auto flex aspect-[210/297] w-full max-w-[34rem] flex-col overflow-hidden border-2 border-ink bg-card text-ink print:max-w-none" style={{ padding: "5.7cqw" }}>
        <span aria-hidden="true" className="absolute -right-[7cqw] top-[4cqw] h-[6cqw] w-[30cqw] rotate-[35deg] bg-marigold/90" />

        <p className="font-bold uppercase tracking-[0.16em]" style={{ fontSize: "2.6cqw" }}>
          Every {singularNight(kit.night)} at {venueName}
        </p>

        <h2 className="mt-[3cqw] font-poster font-black uppercase" style={{ fontSize: "17cqw", lineHeight: 0.92 }}>
          {kit.poster.headline}
        </h2>

        <p className="mt-[3cqw] font-display" style={{ fontSize: "4.4cqw", lineHeight: 1.25 }}>
          {kit.poster.subline}
        </p>

        <div className="mt-[5cqw] -rotate-1 border-2 border-ink" style={{ padding: "3.2cqw" }}>
          <p className="font-display" style={{ fontSize: "4.2cqw", lineHeight: 1.3 }}>
            If you love {listOf(loves)}, this is your night.
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between gap-[4cqw]">
          <div>
            <p className="font-poster font-black uppercase" style={{ fontSize: "7cqw", lineHeight: 1 }}>
              {kit.night.split(",")[0]}
              {time ? `, ${time}` : ""}
            </p>
            {firstNight && (
              <p className="mt-[1cqw]" style={{ fontSize: "2.8cqw" }}>
                First night: {firstNight}
              </p>
            )}
            <p className="mt-[2cqw] max-w-[44cqw]" style={{ fontSize: "3.1cqw", lineHeight: 1.35 }}>
              Come alone. You&apos;ll be seated with people who share your taste.
            </p>
          </div>
          <div className="shrink-0 text-center">
            {/* The QR is a data URL made on the server, so a plain img is right here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt={`QR code for checking in to ${kit.clubName}`} style={{ width: "26cqw", height: "26cqw" }} />
            <p className="font-bold" style={{ fontSize: "2.6cqw" }}>
              Scan when you arrive
            </p>
          </div>
        </div>

        <p className="mt-[4cqw] border-t border-rule pt-[1.6cqw] text-ink-soft" style={{ fontSize: "2.1cqw" }}>
          {kit.poster.footer}
        </p>
      </div>
    </div>
  );
}

// The folded A6 table card: scan to find your table.
export function TableTent({ kit, qr }: { kit: ClubKit; qr: string }) {
  return (
    <div className="@container w-full">
      <div data-poster className="mx-auto flex aspect-[148/105] w-full max-w-[26rem] items-center gap-[5cqw] overflow-hidden border-2 border-ink bg-card text-ink print:max-w-none" style={{ padding: "6cqw" }}>
        <div className="flex-1">
          <p className="font-poster font-black uppercase" style={{ fontSize: "11cqw", lineHeight: 0.95 }}>
            {kit.clubName}
          </p>
          <p className="mt-[3cqw] font-display" style={{ fontSize: "5.4cqw" }}>
            Scan to find your table
          </p>
          <p className="mt-[3cqw]" style={{ fontSize: "3.6cqw", lineHeight: 1.3 }}>
            {kit.nameTagPrompt}. Ask the host about tonight.
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt={`QR code for finding your table at ${kit.clubName}`} style={{ width: "34cqw", height: "34cqw" }} />
      </div>
    </div>
  );
}
