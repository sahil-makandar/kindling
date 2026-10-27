"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { APP_NAME } from "@/src/config/brand";
import { FORMAT_LABEL, type ClubFormat } from "@/src/agent/designer/candidates";
import { COMPONENT_HELP, COMPONENT_LABEL, describeParams, formatScore, resultsLabel, statusLabel } from "@/src/runs/evidence";
import { WEIGHTS } from "@/src/scoring/clubScore";
import type { CandidateView, CandidatesView, ComponentView, EvidenceCall } from "@/src/runs/state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { PageIntro } from "./PageIntro";
import { SparkBurst } from "./Sparks";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { cx } from "./cx";
import { Drawer } from "./Drawer";
import { FlyerCard } from "./FlyerCard";
import { ScoreBar } from "./ScoreBar";
import { VenueMapView } from "./VenueMapLoader";

const formatName = (format: string) => FORMAT_LABEL[format as ClubFormat] ?? format;

function IfYouLove({ club }: { club: CandidateView }) {
  const refs = [club.anchor, ...club.companions];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Built from">
      {refs.map((ref, i) => (
        <li key={`${ref.id}-${i}`}>
          <Chip>{ref.name}</Chip>
        </li>
      ))}
    </ul>
  );
}

function CallRow({ call }: { call: EvidenceCall }) {
  const status = statusLabel(call.status);
  const lines = describeParams(call.params);
  return (
    <li className="rounded-md border-[1.5px] border-rule bg-paper p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{call.endpoint}</span>
        <span className={cx("rounded-sm border-[1.5px] px-1.5 text-xs font-bold", status.ok ? "border-sage" : "border-tomato")}>{status.text}</span>
        <span className="text-ink-soft">{call.ms} ms</span>
        <span className="text-ink-soft">{resultsLabel(call.resultCount)}</span>
        {call.cached && <Chip className="!px-2 !text-[0.65rem]">cached</Chip>}
      </div>
      <p className="mt-1 text-ink-soft">{call.purpose.replace(/[._]/g, " ")}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {lines.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-ink-soft">{line.label}</dt>
            <dd className="break-words">{line.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

// The three bars shown on a card: how the club fits this venue, its surroundings and its city. The drawer lists every part.
const LOCAL_BARS: ComponentView["name"][] = ["venueCrowd", "nearbyPlaces", "cityCulture"];

function EvidenceBody({ club, focus }: { club: CandidateView; focus: ComponentView["name"] | null }) {
  if (club.components.length === 0) {
    return <p className="text-ink-soft">This club was not scored, so there is no evidence trail for it. The run that made it ended before the checking stage.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="text-ink-soft">
        Score = 100 x ({(Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).map((name) => `${WEIGHTS[name].toFixed(2)} ${COMPONENT_LABEL[name].toLowerCase()}`).join(" + ")}). Every part is a number from 0 to 1 with a reason you can read below.
      </p>
      <ol className="flex flex-col gap-4">
        {club.components.map((part) => (
          <li key={part.name} className={cx("rounded-md border-2 p-3", focus === part.name ? "border-marigold bg-marigold/20" : "border-rule")}>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h3 className="text-lg">{COMPONENT_LABEL[part.name]}</h3>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-ember-ink">Scope: {part.scope}</p>
              </div>
              <p className="font-poster text-3xl font-black leading-none">
                {Math.round(part.value * 100)}
                <span className="ml-1 text-sm font-normal text-ink-soft">weight {Math.round(part.weight * 100)}%</span>
              </p>
            </div>
            <p className="mt-1 text-sm text-ink-soft">{COMPONENT_HELP[part.name]}</p>
            <p className="mt-2">{part.reason}</p>
            {part.flagged && <p className="mt-2 text-sm font-bold">Default used: Qloo did not give enough data for this part, so it sits at a neutral value.</p>}
            {part.calls.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2" aria-label={`Qloo calls for ${COMPONENT_LABEL[part.name]}`}>
                {part.calls.map((call) => (
                  <CallRow key={call.id} call={call} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">No single Qloo call produced this number. It comes from the rule described above.</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PicksView({ data }: { data: CandidatesView }) {
  const router = useRouter();
  const [open, setOpen] = useState<{ id: string; focus: ComponentView["name"] | null } | null>(null);
  const [compare, setCompare] = useState(false);
  const [making, setMaking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sparked, setSparked] = useState<string | null>(null);

  const ranked = data.candidates.filter((c) => c.score !== null);
  const unranked = data.candidates.filter((c) => c.score === null);
  const top = ranked.slice(0, 3);
  const others = [...ranked.slice(3), ...unranked];
  const opened = open ? data.candidates.find((c) => c.id === open.id) ?? null : null;

  async function makeClub(candidateId: string) {
    setMaking(candidateId);
    setProblem(null);
    try {
      const response = await fetch("/api/clubs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateId }) });
      const body = (await response.json().catch(() => ({}))) as { clubId?: string; error?: string };
      if (response.ok && body.clubId) {
        // A short spark burst on the chosen flyer, then on to its kit.
        setSparked(candidateId);
        setTimeout(() => router.push(`/clubs/${body.clubId}`), 650);
        return;
      }
      setProblem(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setProblem("We could not reach the server. Check your connection and try again.");
    }
    setMaking(null);
  }

  if (data.candidates.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h1 className="text-[2rem]">No clubs yet</h1>
        <p className="text-ink-soft">{data.run.status === "error" ? (data.run.error ?? "The run stopped before it could design any clubs.") : "The agent is still working on this run."}</p>
        <Button href={`/runs/${data.run.id}`}>Back to the run</Button>
      </Card>
    );
  }

  const heatNote = data.heat ? (data.heat.source === "qloo_heatmap" ? "Where this area's taste is strongest, from Qloo's heatmap." : "Nearby places that match this area's taste, from Qloo place results.") : null;

  return (
    <div className="flex flex-col gap-10">
      {data.run.qlooMode === "fixtures" && (
        <Banner variant="fixture" className="-mx-4 sm:-mx-6">
          Sample data mode: these picks come from hand-written examples, not the live Qloo API.
        </Banner>
      )}

      <PageIntro
        title={`Hidden clubs for ${data.venue.name}`}
        action={
          top[0] ? (
            <Button variant="cta" className="text-lg" disabled={making !== null} onClick={() => void makeClub(top[0].id)}>
              {making === top[0].id ? "Making it..." : "Make the top pick our club"}
            </Button>
          ) : undefined
        }
      >
        Pick the club you want to run. Each score blends your venue&apos;s crowd, the places within 1 km and your city&apos;s culture. Press a bar or &quot;How we know&quot; to see the Qloo calls behind a number.
      </PageIntro>

      <section aria-label="Top picks" className="grid grid-cols-[minmax(0,1fr)] gap-8 md:grid-cols-3">
        {top.map((club, i) => (
          <FlyerCard key={club.id} title={club.title} stamp={formatName(club.format)} score={formatScore(club.score)} tilt={i % 2 === 0 ? "left" : "right"} className="flex flex-col">
            <p>{club.why}</p>
            <div className="mt-3">
              <p className="mb-1 text-sm font-bold">Built from</p>
              <IfYouLove club={club} />
            </div>
            {!club.verified && <p className="mt-3 text-sm font-bold">Not checked with a second Qloo call, so the fit between its parts is a neutral guess.</p>}
            {sparked === club.id && <SparkBurst />}
            <div className="mt-4 flex flex-col">
              {club.components
                .filter((part) => LOCAL_BARS.includes(part.name))
                .map((part) => (
                  <ScoreBar key={part.name} label={COMPONENT_LABEL[part.name]} scope={part.scope} value={part.value} onSelect={() => setOpen({ id: club.id, focus: part.name })} />
                ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setOpen({ id: club.id, focus: null })}>
                How we know
              </Button>
              <Button variant={i === 0 ? "cta" : "primary"} disabled={making !== null} onClick={() => void makeClub(club.id)}>
                {making === club.id ? "Making it..." : "Make this our club"}
              </Button>
            </div>
          </FlyerCard>
        ))}
      </section>

      {problem && (
        <p role="alert" className="rounded-md border-2 border-tomato bg-card p-3 font-bold">
          {problem}
        </p>
      )}

      <section aria-labelledby="compare-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="compare-title" className="text-[2rem]">
            Without Qloo
          </h2>
          <Button variant="secondary" onClick={() => setCompare((v) => !v)} aria-expanded={compare} aria-controls="compare-panel">
            {compare ? "Hide the comparison" : "Show what a plain language model suggests"}
          </Button>
        </div>
        <div id="compare-panel" hidden={!compare}>
          {data.baseline ? (
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <h3 className="text-2xl">With Qloo</h3>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
                  {top.map((club) => (
                    <li key={club.id}>
                      <span className="font-bold">{club.title}</span>: {club.why}
                    </li>
                  ))}
                </ol>
                <p className="mt-4 text-sm font-bold">
                  {APP_NAME}: {top.length} picks, every one built from things Qloo returned for this area.
                </p>
              </Card>
              <Card className="border-dashed">
                <h3 className="text-2xl">A language model alone</h3>
                <p className="mt-1 text-sm text-ink-soft">The same question, with no Qloo data.</p>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5">
                  {data.baseline.ideas.map((idea, i) => (
                    <li key={i}>{idea}</li>
                  ))}
                </ol>
                {data.baseline.verdict && <p className="mt-4 text-sm font-bold">{data.baseline.verdict}</p>}
              </Card>
            </div>
          ) : (
            <Card>
              <p className="text-ink-soft">The comparison was skipped for this run because no language model answered in time. We never show a made-up comparison.</p>
            </Card>
          )}
        </div>
      </section>

      {data.heat && data.heat.points.length > 0 && (
        <section aria-labelledby="heat-title" className="grid gap-4 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div>
            <h2 id="heat-title" className="text-[2rem]">
              Where it lives
            </h2>
            <p className="mt-2 text-ink-soft">{heatNote} Darker dots mean a stronger match.</p>
          </div>
          <div className="h-72 overflow-hidden rounded-md border-2 border-ink">
            <VenueMapView lat={data.venue.lat} lon={data.venue.lon} radiusM={data.run.radiusM ?? 500} heat={data.heat.points} label={`Taste heat around ${data.venue.name}`} />
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section aria-labelledby="others-title" className="min-w-0">
          <h2 id="others-title" className="text-[2rem]">
            Other ideas
          </h2>
          <div className="relative mt-4 w-full max-w-full overflow-x-auto rounded-lg border-2 border-ink bg-card">
            <table className="w-full min-w-[34rem] text-left">
              <caption className="sr-only">Other club ideas, ranked</caption>
              <thead className="border-b-2 border-ink">
                <tr>
                  <th scope="col" className="p-3">Club</th>
                  <th scope="col" className="p-3">Kind of night</th>
                  <th scope="col" className="p-3 text-right">Score</th>
                  <th scope="col" className="p-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {others.map((club) => (
                  <tr key={club.id} className="border-b border-rule last:border-0">
                    <th scope="row" className="p-3 font-bold">{club.title}</th>
                    <td className="p-3">{formatName(club.format)}</td>
                    <td className="p-3 text-right font-poster text-2xl font-black">{formatScore(club.score)}</td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setOpen({ id: club.id, focus: null })} className="min-h-10 rounded-md border-2 border-ink px-3 font-bold">
                          Why
                        </button>
                        <button type="button" disabled={making !== null} onClick={() => void makeClub(club.id)} className="min-h-10 rounded-md border-2 border-ink bg-ink px-3 font-bold text-card disabled:opacity-50">
                          Choose
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="max-w-[68ch] text-sm text-ink-soft">
        {data.counters.qlooCalls} Qloo calls made for this run. Qloo&apos;s taste data is city-wide for media; what makes a pick local is the places, the venue&apos;s own tags and the popularity band, and the drawer shows which calls those were.
      </p>

      <Drawer open={opened !== null} onClose={() => setOpen(null)} title={opened ? `How we know: ${opened.title}` : "How we know"}>
        {opened && <EvidenceBody club={opened} focus={open?.focus ?? null} />}
      </Drawer>
    </div>
  );
}
