"use client";

import { toPng } from "html-to-image";
import { Download, Printer } from "lucide-react";
import { useState } from "react";
import type { ClubKit } from "@/src/agent/producer/kit";
import { FORMAT_LABEL } from "@/src/agent/designer/candidates";
import type { ClubView } from "@/src/clubs/state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { CopyButton } from "./CopyButton";
import { Poster, TableTent } from "./Poster";
import { Tabs, type TabItem } from "./Tabs";

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "poster";
}

function Block({ title, children, copy }: { title: string; children: React.ReactNode; copy?: string }) {
  return (
    <section className="rounded-md border-2 border-ink bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xl">{title}</h3>
        {copy && <CopyButton text={copy} />}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function PrintAndDownload({ fileName }: { fileName: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function download() {
    const node = document.querySelector<HTMLElement>("[data-poster]");
    if (!node) return;
    setBusy(true);
    setProblem(null);
    try {
      const url = await toPng(node, { pixelRatio: 3, cacheBust: true });
      const link = document.createElement("a");
      link.download = `${fileName}.png`;
      link.href = url;
      link.click();
    } catch {
      setProblem("The picture could not be made in this browser. Use Print and choose Save as PDF instead.");
    }
    setBusy(false);
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-3">
      <Button variant="primary" onClick={() => window.print()}>
        <Printer size={18} strokeWidth={1.75} aria-hidden="true" />
        Print
      </Button>
      <Button variant="secondary" onClick={() => void download()} disabled={busy}>
        <Download size={18} strokeWidth={1.75} aria-hidden="true" />
        {busy ? "Making the picture..." : "Download PNG"}
      </Button>
      {problem && (
        <p role="alert" className="basis-full text-sm font-bold">
          {problem}
        </p>
      )}
    </div>
  );
}

export function ClubKitView({ club, kit, qr, checkInUrl }: { club: ClubView; kit: ClubKit; qr: string; checkInUrl: string | null }) {
  const first = [...club.sessions].reverse().find((s) => s.status === "open") ?? club.sessions.at(-1) ?? null;
  const loves = [club.anchor, ...club.companions].filter((r): r is NonNullable<typeof r> => r !== null).map((r) => r.name);
  const picks = [club.anchor, ...club.companions].filter((r): r is NonNullable<typeof r> => r !== null);
  const sessionLine = first ? `Next session: ${longDate(first.date)}, ${kit.night.split(",")[1]?.trim() ?? ""}` : null;

  const tabs: TabItem[] = [
    {
      id: "poster",
      label: "Poster",
      content: (
        <div className="flex flex-col gap-4">
          <p className="no-print max-w-[68ch] text-ink-soft">Print this and put it in the window. The QR code opens the check-in page for your first night.</p>
          <PrintAndDownload fileName={slug(`${kit.clubName}-poster`)} />
          <Poster kit={kit} venueName={club.venue.name} loves={loves} firstNight={first ? longDate(first.date) : null} qr={qr} />
        </div>
      ),
    },
    {
      id: "run",
      label: "Run of show",
      content: (
        <div className="flex flex-col gap-5">
          <p className="text-ink-soft">
            {kit.durationMinutes} minutes, starting at {kit.night.split(",")[1]?.trim()}. Minutes count from when doors open.
          </p>
          <ol className="flex flex-col gap-3 border-l-2 border-ink pl-5">
            {kit.runOfShow.map((step) => (
              <li key={`${step.minute}-${step.title}`} className="relative">
                <span aria-hidden="true" className="absolute -left-[1.7rem] top-1.5 h-3 w-3 rounded-full border-2 border-ink bg-marigold" />
                <p className="font-bold">
                  <span className="font-poster text-2xl font-black">{step.minute}</span> min: {step.title}
                </p>
                <p className="text-ink-soft">{step.detail}</p>
              </li>
            ))}
          </ol>
          <div className="grid gap-4 md:grid-cols-2">
            <Block title="When someone comes alone">{kit.comeAloneRitual}</Block>
            <Block title="Icebreaker" copy={kit.icebreaker}>
              {kit.icebreaker}
            </Block>
            <Block title="Name tag line" copy={kit.nameTagPrompt}>
              {kit.nameTagPrompt}
            </Block>
          </div>
          <Block title="Host script" copy={kit.hostScript}>
            <p className="max-w-[68ch]">{kit.hostScript}</p>
          </Block>
        </div>
      ),
    },
    {
      id: "listing",
      label: "Listing",
      content: (
        <div className="grid gap-4">
          <Block title="Title" copy={kit.listing.title}>
            {kit.listing.title}
          </Block>
          <Block title="Short description" copy={kit.listing.short}>
            {kit.listing.short}
          </Block>
          <Block title="Long description" copy={kit.listing.long}>
            <p className="max-w-[68ch]">{kit.listing.long}</p>
          </Block>
          <Block title="Instagram caption" copy={kit.listing.instagram}>
            {kit.listing.instagram}
          </Block>
        </div>
      ),
    },
    {
      id: "picks",
      label: "Playlist and picks",
      content: (
        <div className="grid gap-4 md:grid-cols-2">
          <Block title="What this club is built from">
            <p className="text-sm text-ink-soft">Each of these came from Qloo results for your area. The number is how strongly people nearby favour it, when Qloo gave one.</p>
            <ul className="mt-3 flex flex-col gap-2">
              {picks.map((pick) => (
                <li key={pick.id} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-bold">{pick.name}</span> <span className="text-sm text-ink-soft">{pick.domain === "tag" ? "genre or theme" : pick.domain.replace("_", " ")}</span>
                  </span>
                  {club.affinities[pick.id] !== undefined && <span className="font-poster text-2xl font-black">{Math.round(club.affinities[pick.id] * 100)}</span>}
                </li>
              ))}
            </ul>
          </Block>
          <Block title="Suggested playlist" copy={kit.playlist.map((p) => p.name).join("\n")}>
            {kit.playlist.length > 0 ? (
              <>
                <p className="text-sm text-ink-soft">Artists the area loves that fit this theme. Pick your own tracks.</p>
                <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5">
                  {kit.playlist.map((item) => (
                    <li key={item.refId}>{item.name}</li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="text-ink-soft">Qloo did not return enough music for this area to suggest a playlist.</p>
            )}
          </Block>
        </div>
      ),
    },
    {
      id: "menu",
      label: "Menu special",
      content: (
        <div className="grid gap-4 md:grid-cols-2">
          <Block title={kit.menuSpecial.name} copy={`${kit.menuSpecial.name}: ${kit.menuSpecial.description}`}>
            {kit.menuSpecial.description}
          </Block>
          <Block title={`Zero-proof: ${kit.menuSpecial.zeroProof.name}`} copy={`${kit.menuSpecial.zeroProof.name}: ${kit.menuSpecial.zeroProof.description}`}>
            {kit.menuSpecial.zeroProof.description}
          </Block>
        </div>
      ),
    },
    {
      id: "trivia",
      label: "Trivia",
      content: (
        <div className="flex flex-col gap-4">
          <Banner variant="simulated">{kit.triviaNote}: a language model drafted these. Check each answer before you read it out.</Banner>
          <ol className="flex list-decimal flex-col gap-3 pl-6">
            {kit.trivia.map((item, i) => (
              <li key={i}>
                <p className="font-bold">{item.q}</p>
                <p className="text-ink-soft">Answer: {item.a}</p>
              </li>
            ))}
          </ol>
        </div>
      ),
    },
    {
      id: "tent",
      label: "Table tent",
      content: (
        <div className="flex flex-col gap-4">
          <p className="no-print max-w-[68ch] text-ink-soft">Print, fold in half and stand one on each table. Guests scan it to find where they are sitting.</p>
          <PrintAndDownload fileName={slug(`${kit.clubName}-table-tent`)} />
          <TableTent kit={kit} qr={qr} />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {club.qlooMode === "fixtures" && (
        <Banner variant="fixture" className="no-print">
          Sample data mode: this club was built from hand-written examples, not the live Qloo API.
        </Banner>
      )}

      <header className="no-print flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[2.5rem]">{kit.clubName}</h1>
          <Chip variant="stamp">{FORMAT_LABEL[kit.format]}</Chip>
        </div>
        <p className="max-w-[68ch] text-lg">{kit.hook}</p>
        <p className="max-w-[68ch] text-ink-soft">
          This is everything you need to run it at {club.venue.name}, every {kit.night}: a poster to print, the run of the night, a listing to post, a playlist and a menu special. {kit.source === "fallback" && "The words in this kit came from a template because the language model was busy."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button href={`/clubs/${club.id}/live`} variant="cta" className="text-lg">
            Run the night
          </Button>
          {checkInUrl && (
            <Button href={checkInUrl} variant="secondary">
              Open the check-in page
            </Button>
          )}
          {club.runId && (
            <Button href={`/runs/${club.runId}/clubs`} variant="secondary">
              Back to the picks
            </Button>
          )}
        </div>
      </header>

      <Tabs tabs={tabs} />

      <footer className="no-print flex flex-col gap-3">
        {kit.licenceNote && (
          <Card className="border-marigold">
            <h2 className="text-xl">Licence note</h2>
            <p className="mt-1 max-w-[68ch]">{kit.licenceNote}</p>
          </Card>
        )}
        {sessionLine && <p className="font-bold">{sessionLine}</p>}
      </footer>
    </div>
  );
}
