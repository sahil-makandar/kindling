"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RunStateView, TraceView } from "@/src/runs/state";
import { NIGHT_LABEL, VENUE_TYPE_LABEL } from "@/src/runs/schema";
import type { CandidatesView } from "@/src/runs/state";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Card } from "./Card";
import { cx } from "./cx";
import { Ember, type EmberMood } from "./Ember";
import { PageIntro } from "./PageIntro";
import { SparkBurst } from "./Sparks";
import { Spinner } from "./Spinner";
import { StatTile } from "./StatTile";
import { VenueMapView } from "./VenueMapLoader";

const STAGES = [
  { id: "locate", title: "Find your venue", doing: "Looking for your venue on Qloo" },
  { id: "scout", title: "Read the neighbourhood", doing: "Reading what people nearby love" },
  { id: "design", title: "Design the clubs", doing: "Designing clubs from what it found" },
  { id: "verify", title: "Check the clubs", doing: "Checking each club with more Qloo calls" },
  { id: "baseline", title: "Compare without Qloo", doing: "Asking a plain language model the same question" },
] as const;

// About how long each stage takes, in seconds, for the progress bar and the time left. These are estimates from real runs.
const EXPECTED_S: Record<string, number> = { locate: 6, scout: 35, design: 15, verify: 20, baseline: 3 };
const TOTAL_S = Object.values(EXPECTED_S).reduce((a, b) => a + b, 0);

function timeLeft(seconds: number): string {
  if (seconds < 10) return "a few seconds left";
  if (seconds < 55) return `about ${Math.round(seconds / 5) * 5} seconds left`;
  return `about ${Math.max(1, Math.round(seconds / 60))} minute${seconds >= 90 ? "s" : ""} left`;
}

const stageIndex = (stage: string) => STAGES.findIndex((s) => s.id === stage);
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const finished = (status: string) => status === "done" || status === "error";

function seconds(ms: number): string {
  const total = Math.floor(ms / 1000);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

type Advance = { state: RunStateView | null; reason: string | null };

// The live run. It asks the server to run one stage at a time, polls for new trace lines while a stage works, and shows
// them one by one. Refreshing the page picks the run up where it is: the server knows which stage is next.
export function RunView({ initial, replay = false }: { initial: RunStateView; replay?: boolean }) {
  const [run, setRun] = useState(initial.run);
  const [counters, setCounters] = useState(initial.counters);
  const [events, setEvents] = useState<TraceView[]>(initial.events);
  const [shown, setShown] = useState(initial.run.status === "done" && !replay ? initial.events.length : 0);
  const [now, setNow] = useState(() => Date.now());
  const [connection, setConnection] = useState<string | null>(null);
  const [stageSince, setStageSince] = useState(() => ({ stage: initial.run.stage as string, at: Date.now() }));
  const [early, setEarly] = useState<CandidatesView["candidates"]>([]);
  const cursor = useRef(initial.cursor);
  const started = useRef(false);
  const mounted = useRef(true);
  const id = initial.run.id;
  const venue = initial.venue;

  const merge = useCallback((state: RunStateView) => {
    if (!mounted.current) return;
    setStageSince((prev) => (prev.stage === state.run.stage ? prev : { stage: state.run.stage, at: Date.now() }));
    setRun(state.run);
    setCounters(state.counters);
    const fresh = state.events.filter((e) => e.id > cursor.current);
    if (fresh.length > 0) {
      cursor.current = Math.max(cursor.current, ...fresh.map((e) => e.id));
      setEvents((all) => [...all, ...fresh]);
    }
  }, []);

  const advance = useCallback(async (): Promise<Advance> => {
    const response = await fetch(`/api/runs/${id}/advance?after=${cursor.current}`, { method: "POST" });
    if (!response.ok) throw new Error(`advance ${response.status}`);
    const body = (await response.json()) as { state: RunStateView | null; reason: string | null };
    return { state: body.state, reason: body.reason };
  }, [id]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (finished(initial.run.status)) return;

    // While a stage runs, fetch its trace lines as they are saved. Advance only answers when the stage ends.
    let stopPolling = false;
    void (async () => {
      while (!stopPolling && mounted.current) {
        await wait(1200);
        try {
          const response = await fetch(`/api/runs/${id}?after=${cursor.current}`);
          if (response.ok) merge((await response.json()) as RunStateView);
        } catch {
          // The advance loop reports connection problems.
        }
      }
    })();

    void (async () => {
      let failures = 0;
      while (mounted.current) {
        try {
          const result = await advance();
          failures = 0;
          setConnection(null);
          if (result.state) merge(result.state);
          if (result.state && finished(result.state.run.status)) break;
          // Another tab is running this stage: look again shortly.
          if (result.reason === "busy") await wait(2000);
        } catch {
          failures += 1;
          if (failures >= 3) setConnection("We lost the connection to the server. Still trying.");
          await wait(Math.min(10000, 1500 * failures));
        }
      }
      stopPolling = true;
    })();
  }, [advance, id, initial.run.status, merge]);

  // Reveal trace lines gently, a few at a time when there is a backlog.
  useEffect(() => {
    if (shown >= events.length) return;
    const behind = events.length - shown;
    // A replay of a finished run moves faster than a live one, since the work is already done.
    const step = replay ? 2 : behind > 12 ? 3 : 1;
    const delay = replay ? 70 : behind > 12 ? 60 : 130;
    const timer = setTimeout(() => setShown((n) => Math.min(events.length, n + step)), delay);
    return () => clearTimeout(timer);
  }, [shown, events.length, replay]);

  useEffect(() => {
    if (finished(run.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.status]);

  // As soon as the clubs are designed, show them while they are still being scored.
  const designed = run.status === "done" || stageIndex(run.stage) >= 3;
  useEffect(() => {
    if (!designed) return;
    let cancelled = false;
    void fetch(`/api/runs/${id}/candidates`)
      .then((response) => (response.ok ? (response.json() as Promise<CandidatesView>) : null))
      .then((view) => {
        if (view && !cancelled) setEarly(view.candidates.slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [designed, id, run.status]);

  const visible = events.slice(0, shown);
  const byStage = useMemo(() => {
    const groups = new Map<string, TraceView[]>();
    for (const e of visible) groups.set(e.stage, [...(groups.get(e.stage) ?? []), e]);
    return groups;
  }, [visible]);

  const current = run.status === "done" ? STAGES.length : stageIndex(run.stage);
  const working = run.status === "pending" || run.status === "running";
  const elapsed = finished(run.status) ? counters.elapsedMs : Math.max(counters.elapsedMs, now - new Date(run.startedAt).getTime());
  const revealed = shown >= events.length;

  const isDone = run.status === "done";
  const stageElapsed = Math.max(0, (now - stageSince.at) / 1000);
  const doneSeconds = STAGES.slice(0, Math.min(current, STAGES.length)).reduce((sum, st) => sum + EXPECTED_S[st.id], 0);
  const inStage = working && current < STAGES.length ? Math.min(stageElapsed, EXPECTED_S[STAGES[current].id] * 0.95) : 0;
  const percent = isDone ? 100 : Math.min(97, Math.round(((doneSeconds + inStage) / TOTAL_S) * 100));
  const remaining = Math.max(3, TOTAL_S - doneSeconds - inStage);
  const mood: EmberMood = run.status === "error" ? "oops" : isDone ? (replay ? "waving" : "cheering") : "thinking";
  const stageNow = STAGES[Math.min(current, STAGES.length - 1)];
  const headline = run.status === "error" ? "The run stopped early" : isDone ? "Your hidden clubs are ready" : `${stageNow.doing}...`;

  return (
    <div className="flex flex-col gap-6">
      {run.qlooMode === "fixtures" && (
        <Banner variant="fixture" className="-mx-4 sm:-mx-6">
          Sample data mode: Qloo answers come from hand-written examples, not the live API.
        </Banner>
      )}

      {replay && (
        <Banner variant="simulated">
          Replay: this venue was already read {ago(initial.run.startedAt, now)}, so the saved run is shown again instead of spending more Qloo calls. Every line below is from that run.
        </Banner>
      )}

      <PageIntro
        title={venue.name}
        action={
          isDone && revealed ? (
            <Button href={`/runs/${id}/clubs`} variant="cta" className="text-lg">
              See your hidden clubs
            </Button>
          ) : undefined
        }
      >
        {VENUE_TYPE_LABEL[venue.venueType as keyof typeof VENUE_TYPE_LABEL] ?? venue.venueType} at {venue.matchedAddress ?? venue.address}, planning for{" "}
        {NIGHT_LABEL[venue.slowNight as keyof typeof NIGHT_LABEL] ?? venue.slowNight} nights. We are reading what your city loves, what is within 1 km of your door and what your venue&apos;s crowd likes.
      </PageIntro>

      <section aria-label="Progress" className="relative flex flex-col gap-3 rounded-lg border-2 border-ink bg-card p-4 shadow-hard sm:flex-row sm:items-center sm:gap-6">
        <div className="relative shrink-0 self-center">
          <Ember mood={mood} size={76} />
          {isDone && !replay && <SparkBurst />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-bold" role="status">
            {headline}
          </p>
          <div
            role="progressbar"
            aria-label="Progress of the run"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-2 h-4 overflow-hidden rounded-full border-2 border-ink bg-rule"
          >
            <div className="h-full rounded-full bg-tomato transition-[width] duration-700 ease-out" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-sm text-ink-soft">
            {run.status === "error" ? "Everything found so far is kept." : isDone ? "All done." : `${percent}% done, ${timeLeft(remaining)}.`}
          </p>
        </div>
        {working && <StageScene stage={stageNow.id} />}
      </section>

      <div className="grid gap-6 lg:grid-cols-[55fr_45fr]">
        <div className="order-2 flex flex-col gap-6 lg:order-1">
          <div className="grid grid-cols-3 gap-3">
            <StatTile value={counters.qlooCalls} label="Qloo calls" />
            <StatTile value={counters.llmCalls} label="Model answers saved" />
            <StatTile value={seconds(elapsed)} label="Time so far" />
          </div>

          <ol aria-label="What the agent did" className="relative flex flex-col gap-6 border-l-2 border-ink pl-6">
            {STAGES.map((stage, i) => {
              const lines = byStage.get(stage.id) ?? [];
              const done = i < current;
              const active = i === current && working;
              if (!done && !active && lines.length === 0) {
                return (
                  <li key={stage.id} className="relative text-ink-soft">
                    <Node state="waiting" />
                    <h2 className="text-xl">{stage.title}</h2>
                  </li>
                );
              }
              return (
                <li key={stage.id} className="relative">
                  <Node state={done ? "done" : "active"} />
                  <h2 className="text-xl">{stage.title}</h2>
                  {active && lines.length === 0 && <Spinner label={`${stage.doing}...`} className="mt-2" />}
                  <ul className="mt-2 flex flex-col gap-2">
                    {lines.map((line) => (
                      <li
                        key={line.id}
                        className={cx(
                          "animate-fade-in border-l-4 py-0.5 pl-3 text-[0.95rem]",
                          line.level === "info" && "border-transparent",
                          line.level === "warn" && "border-marigold",
                          line.level === "error" && "border-tomato font-bold",
                        )}
                      >
                        {line.level === "warn" && <span className="font-bold">Heads up: </span>}
                        {line.message}
                      </li>
                    ))}
                  </ul>
                  {active && lines.length > 0 && <Spinner label="Working..." className="mt-3" />}
                </li>
              );
            })}
          </ol>

          {connection && (
            <p role="status" className="rounded-md border-2 border-marigold bg-card p-3 font-bold">
              {connection}
            </p>
          )}

          {early.length > 0 && (
            <section aria-labelledby="early-title" className="flex flex-col gap-3">
              <h2 id="early-title" className="text-2xl">
                {isDone ? "Your first ideas" : "First ideas, still being scored"}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {early.map((club, i) => (
                  <li key={club.id} className="animate-pin rounded-lg border-2 border-ink bg-card p-3 shadow-hard" style={{ animationDelay: `${i * 90}ms`, ["--tilt" as string]: i % 2 ? "1deg" : "-1deg" }}>
                    <p className="font-display text-lg font-bold leading-tight">{club.title}</p>
                    <p className="mt-1 text-sm text-ink-soft">{club.score !== null ? `Score ${Math.round(club.score)}` : "Scoring..."}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {run.status === "error" && revealed && (
            <Card className="flex flex-col items-start gap-3 border-tomato">
              <h2 className="text-2xl">The run stopped early</h2>
              <p>{run.error ?? "Something went wrong."}</p>
              <div className="flex flex-wrap gap-3">
                <Button href="/" variant="primary">
                  Start again
                </Button>
                <Button href="/sample" variant="secondary">
                  Explore a sample venue
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="order-1 flex flex-col gap-2 lg:order-2">
          <div className="relative h-60 overflow-hidden rounded-lg border-2 border-ink shadow-hard lg:sticky lg:top-4 lg:h-[26rem]">
            <VenueMapView lat={venue.lat} lon={venue.lon} radiusM={run.radiusM ?? 500} label={`Map around ${venue.name}`} />
            {working && stageNow.id === "scout" && (
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[800] grid place-items-center">
                <span className="h-44 w-44 animate-pulse-ring rounded-full border-4 border-tomato" />
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft">
            {run.radiusM ? `Scanning about ${run.radiusM >= 1000 ? `${run.radiusM / 1000} km` : `${run.radiusM} m`} around the venue.` : "The scan area appears once the agent starts reading the neighbourhood."}
          </p>
        </div>
      </div>
    </div>
  );
}

// A small picture of what the agent is doing right now. Short loops, still under reduced motion.
function StageScene({ stage }: { stage: string }) {
  if (stage === "design") {
    return (
      <div aria-hidden="true" className="hidden gap-2 sm:flex">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-12 w-9 animate-pin rounded-sm border-2 border-ink bg-card" style={{ animationDelay: `${i * 220}ms`, animationIterationCount: "infinite", animationDuration: "1.6s", ["--tilt" as string]: `${(i - 1) * 6}deg` }}>
            <span className="mx-auto mt-1 block h-1.5 w-5 rounded-full bg-marigold" />
          </span>
        ))}
      </div>
    );
  }
  if (stage === "verify" || stage === "baseline") {
    return (
      <div aria-hidden="true" className="hidden w-24 flex-col gap-1.5 sm:flex">
        {[70, 45, 85].map((w, i) => (
          <span key={i} className="h-2.5 overflow-hidden rounded-full bg-rule">
            <span className="block h-full animate-pop rounded-full bg-tomato" style={{ width: `${w}%`, animationDelay: `${i * 160}ms` }} />
          </span>
        ))}
      </div>
    );
  }
  return null;
}

function Node({ state }: { state: "waiting" | "active" | "done" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "absolute -left-[2.15rem] top-1.5 h-4 w-4 rounded-full border-2 border-ink",
        state === "done" && "bg-ink",
        state === "active" && "bg-marigold",
        state === "waiting" && "bg-paper",
      )}
    />
  );
}
