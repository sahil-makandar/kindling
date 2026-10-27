"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Recommendation } from "@/src/coach/coach";
import type { WeeklyView as WeeklyData } from "@/src/coach/view";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { PageIntro } from "./PageIntro";
import { SparkBurst } from "./Sparks";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import { StatTile } from "./StatTile";
import { WeeklyChart } from "./WeeklyChart";

const DECISION: Record<Recommendation["decision"], { label: string; tone: string }> = {
  keep: { label: "Keep it", tone: "bg-sage text-ink" },
  tweak: { label: "Tweak it", tone: "bg-ink-blue text-card" },
  switch: { label: "Switch it", tone: "bg-plum text-card" },
};

const SOURCE_NOTE: Record<Recommendation["source"], string | null> = {
  llm: null,
  cache: null,
  mock: "Sample wording from test mode.",
  fallback: "The numbers and the decision are real. The wording came from a template because the language model was busy.",
};

const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

function Tags({ title, tags, empty }: { title: string; tags: string[]; empty: string }) {
  return (
    <div>
      <h3 className="text-xl">{title}</h3>
      {tags.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <Chip>{tag}</Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-ink-soft">{empty}</p>
      )}
    </div>
  );
}

const field = "mt-1 min-h-12 w-full rounded-md border-2 border-ink bg-card px-3 py-2";

function CoachCard({ data }: { data: WeeklyData }) {
  const router = useRouter();
  const [rec, setRec] = useState(data.recommendation);
  const [busy, setBusy] = useState<"ask" | "accept" | "reject" | "edit" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rec?.proposal ?? { variantTitle: "", hook: "", runOfShowChange: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [applied, setApplied] = useState<number | null>(null);

  async function ask() {
    setBusy("ask");
    setProblem(null);
    try {
      const response = await fetch(`/api/clubs/${data.club.id}/coach`, { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { recommendation?: Recommendation; error?: string };
      if (response.ok && body.recommendation) {
        setRec(body.recommendation);
        setDraft(body.recommendation.proposal);
        router.refresh();
      } else setProblem(body.error ?? "The Coach could not answer just now. Please try again.");
    } catch {
      setProblem("We could not reach the server. Please try again.");
    }
    setBusy(null);
  }

  async function respond(action: "accept" | "reject" | "edit") {
    if (!rec) return;
    setBusy(action);
    setProblem(null);
    try {
      const response = await fetch(`/api/recommendations/${rec.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "edit" ? { action, proposal: draft } : { action }),
      });
      const body = (await response.json().catch(() => ({}))) as { recommendation?: Recommendation; sessionNumber?: number | null; error?: string };
      if (response.ok && body.recommendation) {
        setRec(body.recommendation);
        setApplied(body.sessionNumber ?? null);
        setEditing(false);
        router.refresh();
      } else setProblem(body.error ?? "That did not save. Please try again.");
    } catch {
      setProblem("We could not reach the server. Please try again.");
    }
    setBusy(null);
  }

  if (!rec) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-2xl">The Coach</h2>
        <p className="max-w-[60ch] text-ink-soft">After a night with check-ins, the Coach reads the numbers and recommends whether to keep, tweak or switch the club for next week.</p>
        {data.nights.length === 0 ? (
          <p className="font-bold">No check-ins yet. Once guests have checked in, the Coach can read the night.</p>
        ) : (
          <Button variant="cta" onClick={() => void ask()} disabled={busy !== null}>
            {busy === "ask" ? "Reading the night..." : "Ask the Coach"}
          </Button>
        )}
        {busy === "ask" && <Spinner label="Reading the room and asking Qloo for nearby themes..." />}
        {problem && (
          <p role="alert" className="font-bold">
            {problem}
          </p>
        )}
      </Card>
    );
  }

  const decision = DECISION[rec.decision];
  const settled = rec.status !== "proposed";
  const note = SOURCE_NOTE[rec.source];
  const s = rec.signals;

  return (
    <Card className="flex flex-col gap-4 shadow-hard">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl">The Coach says</h2>
        <span className={cx("-rotate-2 rounded-full border-2 border-ink px-4 py-1 font-poster text-3xl font-extrabold uppercase tracking-wide", decision.tone)}>{decision.label}</span>
      </div>
      <p className="max-w-[68ch] text-lg">{rec.rationale}</p>
      <p className="text-sm text-ink-soft">
        Check-ins {s.attendance.join(", ")}. Trend {s.trend > 0 ? "+" : ""}
        {s.trend} a night. {Math.round(s.returnRate * 100)}% came back. {s.regularsMade} regular{s.regularsMade === 1 ? "" : "s"} so far. Drift {s.driftMissing ? "not measured" : s.drift.toFixed(2)}.
      </p>
      {note && <p className="text-sm font-bold">{note}</p>}

      <div className="rounded-md border-2 border-dashed border-ink p-4">
        <p className="text-sm font-bold uppercase tracking-[0.12em] text-ink-soft">Next session&apos;s variant</p>
        {editing ? (
          <form
            className="mt-2 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void respond("edit");
            }}
          >
            <label className="font-bold">
              Title
              <input className={field} value={draft.variantTitle} maxLength={80} onChange={(e) => setDraft({ ...draft, variantTitle: e.target.value })} />
            </label>
            <label className="font-bold">
              One-line hook
              <input className={field} value={draft.hook} maxLength={110} onChange={(e) => setDraft({ ...draft, hook: e.target.value })} />
            </label>
            <label className="font-bold">
              Change to the running order
              <textarea className={cx(field, "min-h-24")} value={draft.runOfShowChange} maxLength={500} onChange={(e) => setDraft({ ...draft, runOfShowChange: e.target.value })} />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="cta" disabled={busy !== null}>
                {busy === "edit" ? "Saving..." : "Save and use this"}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy !== null}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="mt-1 font-display text-2xl">{rec.proposal.variantTitle}</p>
            <p className="mt-1">{rec.proposal.hook}</p>
            <p className="mt-2 text-ink-soft">{rec.proposal.runOfShowChange}</p>
          </>
        )}
      </div>

      {settled ? (
        <p role="status" className="font-bold">
          {rec.status === "rejected"
            ? "Rejected. Next week runs as usual."
            : `${rec.status === "edited" ? "Saved with your changes" : "Accepted"}${applied ?? data.next?.number ? `: session ${applied ?? data.next?.number} will use this variant.` : "."}`}
        </p>
      ) : (
        !editing && (
          <div className="flex flex-wrap gap-3">
            <Button variant="cta" onClick={() => void respond("accept")} disabled={busy !== null}>
              {busy === "accept" ? "Saving..." : "Accept"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy !== null}>
              Edit
            </Button>
            <Button variant="secondary" onClick={() => void respond("reject")} disabled={busy !== null}>
              {busy === "reject" ? "Saving..." : "Reject"}
            </Button>
          </div>
        )
      )}
      {problem && (
        <p role="alert" className="font-bold">
          {problem}
        </p>
      )}
    </Card>
  );
}

export function WeeklyReport({ data }: { data: WeeklyData }) {
  const { club, tiles, nights } = data;
  const rec = data.recommendation;
  const baselineNote = tiles.baseline !== null ? `Up from about ${tiles.baseline} on a normal night` : undefined;
  const upBy = tiles.baseline !== null ? tiles.seatsFilled - tiles.baseline : null;

  return (
    <div className="flex flex-col gap-8">
      {club.qlooMode === "fixtures" && (
        <Banner variant="fixture" className="-mx-4 sm:-mx-6">
          Sample data mode: Qloo answers come from hand-written examples, not the live API.
        </Banner>
      )}

      <PageIntro
        title={club.title}
        action={
          data.next ? (
            <Button href={`/clubs/${club.id}/live`} variant="cta" className="text-lg">
              Run the next night
            </Button>
          ) : undefined
        }
      >
        How your club is growing at {club.venue.name}: who came, who came back, and what the Coach suggests for next week.
        {club.venue.isDemo ? " This venue is fictional, a sample." : ""}
      </PageIntro>

      {data.anySimulated && (
        <Banner variant="simulated">
          Simulated weeks for the sample venue. These nights and guests are generated as a sample, seated by the real seating code. Real clubs show only real check-ins.
        </Banner>
      )}

      {nights.length === 0 ? (
        <Card>
          <h2 className="text-2xl">No nights yet</h2>
          <p className="mt-2 text-ink-soft">Check-ins appear here after the first night. Open the club kit, print the poster and share the check-in code.</p>
          <div className="mt-4">
            <Button href={`/clubs/${club.id}`}>Open the club kit</Button>
          </div>
        </Card>
      ) : (
        <>
          <section aria-label="Headline numbers" className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
            <div className="relative">
              <StatTile hero value={tiles.regularsMade} label="Regulars made: people who have come 3 or more times" />
              {tiles.regularsMade > 0 && <SparkBurst />}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile value={Math.round(tiles.returnRate * 100)} suffix="%" label="Of last night came back" />
              <StatTile value={tiles.seatsFilled} label="Seats filled last night" delta={upBy !== null ? `${upBy >= 0 ? "+" : ""}${upBy} vs ${baselineNote?.replace("Up from ", "")}` : undefined} deltaTone={upBy !== null && upBy >= 0 ? "up" : "neutral"} />
              <StatTile value={tiles.strangersSeated} label="Pairs seated by taste who had not met" />
            </div>
          </section>

          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:items-start">
            <section aria-labelledby="chart-title">
              <h2 id="chart-title" className="text-[2rem]">
                Who came each night
              </h2>
              <div className="mt-3 rounded-lg border-2 border-ink bg-card p-4 shadow-hard">
                <WeeklyChart nights={nights} baseline={tiles.baseline} />
              </div>
            </section>

            <section aria-labelledby="coach-title">
              <h2 id="coach-title" className="sr-only">
                The Coach
              </h2>
              <CoachCard key={rec?.id ?? "none"} data={data} />
            </section>
          </div>
        </>
      )}

      {nights.length === 0 && (
        <section aria-labelledby="coach-title">
          <h2 id="coach-title" className="sr-only">
            The Coach
          </h2>
          <CoachCard key={rec?.id ?? "none"} data={data} />
        </section>
      )}

      {rec && (
        <section aria-labelledby="taste-title" className="rounded-md border-2 border-ink bg-card p-5">
          <h2 id="taste-title" className="text-[2rem]">
            Room taste and club taste
          </h2>
          <p className="mt-1 text-ink-soft">
            {rec.signals.driftMissing ? "Qloo gave no theme tags for the club, so the drift is not measured." : `Drift ${rec.signals.drift.toFixed(2)}: 0 means the room loves exactly what the club is about, 1 means the two have nothing in common.`}
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <Tags title="What the room loves" tags={rec.signals.roomTags} empty="No taste data from the last night." />
            <Tags title="What the club is about" tags={rec.signals.clubTags} empty="No theme tags for the club." />
          </div>
          {rec.signals.adjacent.length > 0 && (
            <div className="mt-6">
              <Tags title="Next to what the room loves, near the venue (from Qloo)" tags={rec.signals.adjacent} empty="" />
            </div>
          )}
        </section>
      )}

      {data.next && (
        <section aria-labelledby="next-title" className="flex flex-col gap-2">
          <h2 id="next-title" className="text-[2rem]">
            Next session
          </h2>
          <p className="text-lg">
            Session {data.next.number}: {longDate(data.next.date)}
          </p>
          {data.next.variant && (
            <p>
              Variant: <span className="font-bold">{data.next.variant.variantTitle}</span>. {data.next.variant.hook}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <Button href={`/clubs/${club.id}/live`} variant="primary">
              Open the live night view
            </Button>
            <Button href={`/c/${data.next.checkInCode}`} variant="secondary">
              Open the check-in page
            </Button>
            <Button href={`/clubs/${club.id}`} variant="secondary">
              Club kit
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
