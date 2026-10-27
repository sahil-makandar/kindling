"use client";

import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DOMAIN_NOUN, FAVOURITE_COUNT, type FavouriteDomain, type FavouriteInput } from "@/src/checkin/schema";
import type { CheckInResult } from "@/src/checkin/checkIn";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { Spinner } from "./Spinner";

type Hit = { id: string; name: string; domain: FavouriteDomain; hint: string | null };

function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

const input = "mt-2 min-h-14 w-full rounded-md border-2 border-ink bg-card px-4 py-3 text-lg placeholder:text-ink-soft";

// Autocomplete over films, music, shows, books and podcasts. Every result is a real Qloo entity.
function PickSearch({ chosen, onPick }: { chosen: FavouriteInput[]; onPick: (hit: Hit) => void }) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const latest = useRef(0);
  const listId = useId();

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setState("loading");
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const body = (await response.json().catch(() => ({}))) as { results?: Hit[]; error?: string };
        if (ticket !== latest.current) return;
        if (!response.ok) {
          setHits([]);
          setState("error");
          return;
        }
        const fresh = (body.results ?? []).filter((r) => !chosen.some((c) => c.id === r.id));
        setHits(fresh);
        setState(fresh.length === 0 ? "empty" : "idle");
      } catch {
        if (ticket === latest.current) setState("error");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [text, chosen]);

  // A short query shows nothing, whatever the last search left behind.
  const active = text.trim().length >= 2;
  const shownHits = active ? hits : [];
  const shownState = active ? state : "idle";

  return (
    <div>
      <label htmlFor="search" className="text-lg font-bold">
        Search for something you love
      </label>
      <div className="relative">
        <Search size={20} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 mt-1 -translate-y-1/2" />
        <input
          id="search"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
          aria-controls={listId}
          placeholder="A film, band, show, book or podcast"
          className={`${input} pl-12`}
        />
      </div>
      <div id={listId} aria-live="polite">
        {shownState === "loading" && <p className="mt-3 text-ink-soft">Searching...</p>}
        {shownState === "empty" && <p className="mt-3 text-ink-soft">Nothing found for that. Try the full title or a different spelling.</p>}
        {shownState === "error" && <p className="mt-3 font-bold">The search is not answering. Try again in a moment.</p>}
        {shownHits.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {shownHits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(hit);
                    setText("");
                    setHits([]);
                  }}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-md border-2 border-ink bg-card px-4 py-2 text-left hover:bg-marigold"
                >
                  <span className="font-bold">
                    {hit.name}
                    {hit.hint && <span className="ml-2 font-normal text-ink-soft">{hit.hint}</span>}
                  </span>
                  <Chip>{DOMAIN_NOUN[hit.domain]}</Chip>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Step = "name" | "picks" | "working" | "done";

export function CheckInFlow({
  code,
  clubTitle,
  venueName,
  date,
  returningName,
}: {
  code: string;
  clubTitle: string;
  venueName: string;
  date: string;
  returningName: string | null;
}) {
  const [step, setStep] = useState<Step>("name");
  const [nickname, setNickname] = useState(returningName ?? "");
  const [picks, setPicks] = useState<FavouriteInput[]>([]);
  const [consentSeating, setConsentSeating] = useState(true);
  const [remember, setRemember] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [forgotten, setForgotten] = useState(false);

  async function submit() {
    setProblem(null);
    setStep("working");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, nickname, favourites: picks, consentSeating, remember }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = (await response.json().catch(() => ({}))) as Partial<CheckInResult> & { error?: string };
      if (!response.ok) {
        setProblem(body.error ?? "Something went wrong. Please try again.");
        setStep("picks");
        return;
      }
      setResult(body as CheckInResult);
      setStep("done");
    } catch {
      setProblem("That took too long. Check your connection and try again, or ask the host to seat you.");
      setStep("picks");
    }
  }

  async function forget() {
    if (!result) return;
    try {
      const response = await fetch("/api/checkin/forget", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ checkinId: result.checkinId }) });
      if (response.ok) setForgotten(true);
      else setProblem("We could not delete your details just now. Please try again.");
    } catch {
      setProblem("We could not reach the server. Please try again.");
    }
  }

  const header = (
    <header className="mb-6">
      <p className="text-sm font-bold uppercase tracking-[0.12em] text-ink-soft">{venueName}</p>
      <h1 className="mt-1 text-[2rem]">{clubTitle}</h1>
      <p className="text-ink-soft">{longDate(date)}</p>
    </header>
  );

  if (step === "name") {
    return (
      <div className="mx-auto max-w-md">
        {header}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nickname.trim()) setStep("picks");
          }}
        >
          {returningName && <p className="mb-3 font-bold">Welcome back, {returningName}.</p>}
          <label htmlFor="nickname" className="text-xl font-bold">
            What should we call you?
          </label>
          <p className="text-ink-soft">A first name or a nickname is enough.</p>
          <input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={30} autoComplete="given-name" className={input} />
          <Button type="submit" variant="cta" className="mt-5 w-full" disabled={!nickname.trim()}>
            Next
          </Button>
        </form>
      </div>
    );
  }

  if (step === "working") {
    return (
      <div className="mx-auto max-w-md">
        {header}
        <Card className="flex flex-col items-start gap-3">
          <Spinner label="Finding your people..." />
          <p className="text-ink-soft">This takes a few seconds. If it takes too long we will let you sit anywhere tonight.</p>
        </Card>
      </div>
    );
  }

  if (step === "done" && result) {
    const seated = result.state === "seated" || result.state === "first";
    return (
      <div className="mx-auto max-w-md">
        {header}
        <section aria-live="polite" className="flex flex-col gap-5">
          <div>
            {seated && result.table !== null ? (
              <p className="font-poster text-[5.5rem] font-black uppercase leading-[0.9] text-ember-ink">Table {result.table}</p>
            ) : (
              <p className="font-display text-3xl">You are checked in.</p>
            )}
            <p className="mt-2 text-lg">{result.message}</p>
          </div>

          {result.tablemates.length > 0 && (
            <Card>
              <p className="font-bold">With you: {result.tablemates.join(", ")}</p>
              {result.sharedLine && <p className="mt-1">{result.sharedLine}</p>}
            </Card>
          )}

          <div className="-rotate-1 rounded-md border-2 border-ink bg-card">
            <p className="bg-tomato px-4 py-2 text-center text-sm font-bold uppercase tracking-[0.2em] text-ink">Hello, I am</p>
            <p className="px-4 py-4 text-center font-display text-4xl">{result.nickname}</p>
            <p className="border-t-2 border-rule px-4 py-3 text-center font-bold">{result.nameTag}</p>
          </div>

          {problem && (
            <p role="alert" className="font-bold">
              {problem}
            </p>
          )}
          {forgotten ? (
            <p role="status" className="font-bold">
              Done. Your name and favourites have been deleted.
            </p>
          ) : (
            <button type="button" onClick={() => void forget()} className="min-h-12 self-start underline">
              Forget me
            </button>
          )}
          <p className="text-sm text-ink-soft">Forget me deletes your name, your favourites and every check-in linked to you.</p>
        </section>
      </div>
    );
  }

  const left = FAVOURITE_COUNT - picks.length;
  return (
    <div className="mx-auto max-w-md">
      {header}
      <h2 className="text-xl">Pick {FAVOURITE_COUNT} things you love</h2>
      <p className="mb-4 text-ink-soft">Films, music, shows, books or podcasts. We use them to seat you with people who love similar things.</p>

      {picks.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2" aria-label="Your picks">
          {picks.map((pick) => (
            <li key={pick.id} className="flex min-h-12 items-center justify-between gap-3 rounded-md border-2 border-ink bg-marigold/40 px-4 py-2">
              <span className="font-bold">
                {pick.name} <span className="font-normal text-ink-soft">{DOMAIN_NOUN[pick.domain]}</span>
              </span>
              <button type="button" onClick={() => setPicks((all) => all.filter((p) => p.id !== pick.id))} aria-label={`Remove ${pick.name}`} className="flex h-10 w-10 items-center justify-center rounded-md border-2 border-ink bg-card">
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {left > 0 ? (
        <PickSearch chosen={picks} onPick={(hit) => setPicks((all) => (all.length < FAVOURITE_COUNT ? [...all, { id: hit.id, name: hit.name, domain: hit.domain }] : all))} />
      ) : (
        <p className="font-bold">That is three. Check the boxes below and go.</p>
      )}
      {left > 0 && picks.length > 0 && <p className="mt-3 text-sm text-ink-soft">{left} more to go.</p>}

      <fieldset className="mt-6 flex flex-col gap-3">
        <legend className="sr-only">Your choices</legend>
        <label className="flex min-h-12 items-start gap-3">
          <input type="checkbox" checked={consentSeating} onChange={(e) => setConsentSeating(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-ink" />
          <span>Seat me with people who share my taste</span>
        </label>
        <label className="flex min-h-12 items-start gap-3">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-ink" />
          <span>Remember me on this device so I count as a regular</span>
        </label>
      </fieldset>

      {problem && (
        <p role="alert" className="mt-4 rounded-md border-2 border-tomato bg-card p-3 font-bold">
          {problem}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button variant="secondary" onClick={() => setStep("name")}>
          Back
        </Button>
        <Button variant="cta" className="flex-1" disabled={picks.length !== FAVOURITE_COUNT} onClick={() => void submit()}>
          Check me in
        </Button>
      </div>
    </div>
  );
}
