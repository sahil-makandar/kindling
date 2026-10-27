"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Board } from "@/src/checkin/repo";
import { sharedLine } from "@/src/seating/describe";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { PageIntro } from "./PageIntro";
import { StatTile } from "./StatTile";

const POLL_MS = 5000;

const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const field = "mt-1 min-h-12 w-full rounded-md border-2 border-ink bg-card px-3 py-2";

// The host's view of the night: who is here, where they sit and why. Refreshes every five seconds.
export function LiveBoard({ clubId, clubTitle, initial, qr, checkInPath }: { clubId: string; clubTitle: string; initial: Board; qr: string; checkInPath: string }) {
  const [board, setBoard] = useState(initial);
  const [busy, setBusy] = useState<"rebalance" | "close" | "open" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [headcount, setHeadcount] = useState("");
  const [vibe, setVibe] = useState("");
  const [stale, setStale] = useState(false);
  const mounted = useRef(true);
  const sessionId = initial.session.id;
  const open = board.session.status === "open";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/board`, { cache: "no-store" });
      if (!response.ok) throw new Error("board");
      const next = (await response.json()) as Board;
      if (mounted.current) {
        setBoard(next);
        setStale(false);
      }
    } catch {
      if (mounted.current) setStale(true);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  async function post(url: string, body?: unknown): Promise<Response | null> {
    setProblem(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (response.ok) return response;
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setProblem(data.error ?? "That did not work. Please try again.");
    } catch {
      setProblem("We could not reach the server. Please try again.");
    }
    return null;
  }

  async function rebalance() {
    setBusy("rebalance");
    const response = await post(`/api/sessions/${sessionId}/rebalance`);
    if (response) setBoard((await response.json()) as Board);
    setBusy(null);
  }

  async function close() {
    setBusy("close");
    const body: { headcount?: number; vibe?: number } = {};
    if (headcount.trim() !== "") body.headcount = Number(headcount);
    if (vibe !== "") body.vibe = Number(vibe);
    const response = await post(`/api/sessions/${sessionId}/close`, body);
    if (response) {
      setBoard((await response.json()) as Board);
      setClosing(false);
    }
    setBusy(null);
  }

  async function openNext() {
    setBusy("open");
    const response = await post(`/api/clubs/${clubId}/sessions`);
    if (response) window.location.reload();
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {board.session.simulated && <Banner variant="simulated">Simulated night for the sample venue. These guests are generated, not real people.</Banner>}

      <PageIntro
        title={clubTitle}
        aside={<p className="mt-1 text-sm font-bold uppercase tracking-[0.12em] text-ink-soft">Session {board.session.number}, {longDate(board.session.date)}. Check-in is {open ? "open" : "closed"}.</p>}
        action={
          <div className="flex items-center gap-4 rounded-lg border-2 border-ink bg-card p-3 shadow-hard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for checking in" className="h-24 w-24" />
            <div>
              <p className="font-bold">Scan to check in</p>
              <p className="font-poster text-3xl font-extrabold tracking-widest">{board.session.checkInCode}</p>
              <a href={checkInPath} className="inline-block py-3 text-sm">
                Open the check-in page
              </a>
            </div>
          </div>
        }
      >
        Tonight, as it happens: guests appear here as they check in, seated at tables by shared taste. Show this code or the poster, and tap Rebalance if the room changes.
      </PageIntro>

      <section aria-label="Numbers" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile value={board.checkedIn} label="Checked in" />
        <StatTile value={board.tables.length} label="Tables" />
        <StatTile value={board.waiting.length} label="Waiting for a seat" />
        <StatTile value={board.free.length} label="Sitting anywhere" />
      </section>

      {stale && (
        <p role="status" className="rounded-md border-2 border-marigold bg-card p-3 font-bold">
          We could not refresh just now. Showing the last view and trying again.
        </p>
      )}

      {board.checkedIn === 0 ? (
        <Card>
          <h2 className="text-2xl">Nobody has checked in yet</h2>
          <p className="mt-2 text-ink-soft">Guests scan the QR code on the poster or the table tent. Their names appear here as they arrive, seated by taste.</p>
        </Card>
      ) : (
        <section aria-label="Tables" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {board.tables.map((table) => {
            const line = sharedLine(table.explanation);
            return (
              <article key={table.number} className="rounded-md border-2 border-ink bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-poster text-5xl font-black uppercase leading-none">Table {table.number}</h2>
                  <Chip>{table.members.length} here</Chip>
                </div>
                <ul className="mt-4 flex flex-wrap gap-2" aria-label={`Guests at table ${table.number}`}>
                  {table.members.map((member) => (
                    <li key={member.checkinId} className="rounded-md border-2 border-ink bg-paper px-3 py-1 text-lg font-bold">
                      {member.nickname}
                      {member.regular && <span className="ml-2 align-middle text-xs font-bold uppercase tracking-wide text-ink-soft">regular</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-4">{line ?? "A fresh mix. Nothing in common yet, so start with the icebreaker."}</p>
              </article>
            );
          })}
        </section>
      )}

      {board.waiting.length > 0 && (
        <Card>
          <h2 className="text-2xl">Waiting for a seat</h2>
          <p className="mt-1 text-ink-soft">Tables are full. Offer them the bar. Two people waiting open a new table together.</p>
          <p className="mt-2 font-bold">{board.waiting.map((w) => w.nickname).join(", ")}</p>
        </Card>
      )}

      {board.free.length > 0 && (
        <Card>
          <h2 className="text-2xl">Sitting anywhere</h2>
          <p className="mt-1 text-ink-soft">They chose not to be matched, or Qloo was slow. Welcome them like everyone else.</p>
          <p className="mt-2 font-bold">{board.free.map((w) => w.nickname).join(", ")}</p>
        </Card>
      )}

      {problem && (
        <p role="alert" className="rounded-md border-2 border-tomato bg-card p-3 font-bold">
          {problem}
        </p>
      )}

      <section aria-label="Host actions" className="flex flex-col gap-4">
        {open ? (
          <>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" onClick={() => void rebalance()} disabled={busy !== null || board.checkedIn < 2}>
                {busy === "rebalance" ? "Re-balancing..." : "Re-balance tables"}
              </Button>
              <Button variant="secondary" onClick={() => setClosing((v) => !v)} aria-expanded={closing} disabled={busy !== null}>
                Close tonight&apos;s session
              </Button>
            </div>
            <p className="max-w-[68ch] text-sm text-ink-soft">Re-balance seats everyone who asked to be matched again from scratch. Some people may be asked to move, so use it before the night starts or after a lot of late arrivals.</p>
            {closing && (
              <Card className="max-w-lg">
                <h2 className="text-2xl">Close tonight</h2>
                <p className="mt-1 text-ink-soft">Both boxes are optional. They help the Coach read the night.</p>
                <form
                  className="mt-3 flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void close();
                  }}
                >
                  <label className="font-bold">
                    How many people were really here?
                    <input className={field} inputMode="numeric" value={headcount} onChange={(e) => setHeadcount(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                  </label>
                  <label className="font-bold">
                    How did the night feel?
                    <select className={field} value={vibe} onChange={(e) => setVibe(e.target.value)}>
                      <option value="">Skip</option>
                      <option value="1">1, flat</option>
                      <option value="2">2</option>
                      <option value="3">3, fine</option>
                      <option value="4">4</option>
                      <option value="5">5, buzzing</option>
                    </select>
                  </label>
                  <div className="flex gap-3">
                    <Button type="submit" variant="cta" disabled={busy !== null}>
                      {busy === "close" ? "Closing..." : "Close the session"}
                    </Button>
                    <Button variant="secondary" onClick={() => setClosing(false)} disabled={busy !== null}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </Card>
            )}
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="font-bold">
              Closed.{board.session.headcountManual !== null ? ` Headcount ${board.session.headcountManual}.` : ""}
              {board.session.vibeRating !== null ? ` Vibe ${board.session.vibeRating} out of 5.` : ""}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="cta" href={`/clubs/${clubId}/weeks`}>
                See the weekly report
              </Button>
              <Button variant="secondary" onClick={() => void openNext()} disabled={busy !== null}>
                {busy === "open" ? "Opening..." : "Open next week's session"}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
