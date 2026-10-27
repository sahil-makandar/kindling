import type { Metadata } from "next";
import { APP_NAME, REPO_URL } from "@/src/config/brand";
import { getDb } from "@/src/db/client";
import { getQlooUsage, QLOO_USES, type UsageRow } from "@/src/runs/usage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: `How it works | ${APP_NAME}`, description: "What the agent does, which Qloo calls it makes and why, and what it does not do." };

const FACTS = [
  { number: "6%", text: "of restaurant reservations are for Monday nights, and 8% for Tuesday (Toast data).", url: "https://www.chowhound.com/1841628/why-restaurants-closed-on-mondays" },
  { number: "1 in 6", text: "people is affected by loneliness (WHO Commission on Social Connection, 2025).", url: "https://www.who.int/groups/commission-on-social-connection" },
  { number: "50 h", text: "of time together turns an acquaintance into a casual friend (Jeffrey Hall, 2018). One-off events cannot reach that. A weekly club can.", url: "https://news.ku.edu/2018/03/06/study-reveals-number-hours-it-takes-make-friend" },
] as const;

const LOOP = [
  { name: "Scout", text: "Reads what the neighbourhood loves with Qloo." },
  { name: "Design", text: "Proposes hidden clubs from that evidence." },
  { name: "Verify", text: "Checks and scores each club with more Qloo calls." },
  { name: "Produce", text: "Writes the kit: poster, run of show, listing, menu." },
  { name: "Seat", text: "Seats guests by taste at check-in." },
  { name: "Coach", text: "Reads the week and says keep, tweak or switch." },
] as const;

const ROLES = [
  { role: "Locator", does: "Finds the venue on Qloo and reads its own tags." },
  { role: "Scout", does: "A model-driven tool loop. It chooses which Qloo scans to run, widens the radius when data is thin, and records a reason for each call." },
  { role: "Designer", does: "Proposes 6 to 8 clubs from the Scout's signal pool. Every club must cite things that are really in the pool, and anything else is dropped by code." },
  { role: "Verifier", does: "Checks the top clubs with a coherence call and scores all of them with a fixed formula." },
  { role: "Producer", does: "Writes the club kit. The playlist is picked by code from the pool, and a licence note is added whenever a text mentions screening a film." },
  { role: "Seater", does: "Pure code. Weighted tag overlap decides who sits together, and nobody is left alone." },
  { role: "Coach", does: "Fixed rules decide keep, tweak or switch from the real numbers. The model only writes the wording." },
  { role: "Baseline", does: "Asks a plain language model the same question with no Qloo data, so you can compare." },
] as const;

const WHO = [
  { what: "Qloo", items: "What the area loves, what is rising, which clubs fit together, each guest's taste vector, nearby places and the heat map." },
  { what: "The language model", items: "Wording and creative choices: club titles, the kit text, the Coach's variant, and the comparison with no Qloo data. It never sees a guest's name or picks." },
  { what: "Our code", items: "The club score, the seating, the keep, tweak or switch decision, the regulars count, the licence note and every check that a cited thing exists." },
] as const;

const SCORE = [
  ["Loved around here", "30%", "How strongly people near the venue favour the anchor."],
  ["Fits together", "20%", "Whether the anchor and companions belong together, from a Qloo call."],
  ["Fits your venue", "15%", "Whether people who like places like yours like it too."],
  ["Rising now", "10%", "Whether it is trending in the area."],
  ["Known but not too common", "15%", "Popular enough to draw a crowd, niche enough to feel like identity."],
  ["Right kind of night", "10%", "How well the format suits this kind of venue. A rule, not a Qloo call."],
] as const;

async function usage(): Promise<UsageRow[]> {
  try {
    return await getQlooUsage(getDb());
  } catch {
    // The table still explains every call if the counts cannot be read.
    return QLOO_USES.map((u) => ({ ...u, calls: 0, avgMs: null }));
  }
}

export default async function HowPage() {
  const rows = await usage();
  const total = rows.reduce((sum, r) => sum + r.calls, 0);

  return (
    <div className="flex max-w-[68ch] flex-col gap-12 lg:max-w-none">
      <header className="max-w-[68ch]">
        <h1 className="text-[2.5rem]">How {APP_NAME} works</h1>
        <p className="mt-3 text-lg">
          {APP_NAME} turns a venue&apos;s empty weeknight into a weekly club for people with the same taste. This page is for anyone who wants to check what is real, what is Qloo, and what is not claimed.
        </p>
      </header>

      <section aria-labelledby="problem" className="flex flex-col gap-4">
        <h2 id="problem" className="text-[2rem]">
          The problem, in numbers
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {FACTS.map((fact) => (
            <li key={fact.number} className="rounded-md border-2 border-ink bg-card p-5">
              <p className="font-poster text-6xl font-black leading-none text-tomato">{fact.number}</p>
              <p className="mt-2">{fact.text}</p>
              <p className="mt-2 break-words text-sm text-ink-soft">
                Source: <a href={fact.url}>{fact.url}</a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="loop" className="flex flex-col gap-4">
        <h2 id="loop" className="text-[2rem]">
          The weekly loop
        </h2>
        <ol className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {LOOP.map((step, i) => (
            <li key={step.name} className="relative rounded-md border-2 border-ink bg-card p-4">
              <p className="font-poster text-3xl font-black text-tomato" aria-hidden="true">
                {i + 1}
              </p>
              <h3 className="text-xl">{step.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="max-w-[68ch]">
          Then it goes round again. The same people come back, the Coach reads who came and who returned, and next week&apos;s plan changes because of it. That repeat is the point: friendships need hours together, and one night cannot give them.
        </p>
      </section>

      <section aria-labelledby="roles" className="flex flex-col gap-4">
        <h2 id="roles" className="text-[2rem]">
          The agent roles
        </h2>
        <dl className="grid gap-3 md:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.role} className="rounded-md border-2 border-rule bg-card p-4">
              <dt className="text-xl font-bold">{r.role}</dt>
              <dd className="mt-1">{r.does}</dd>
            </div>
          ))}
        </dl>
        <p className="max-w-[68ch]">Each stage is its own request and writes a plain-language trace, which is what you see on the run page.</p>
      </section>

      <section aria-labelledby="split" className="flex flex-col gap-4">
        <h2 id="split" className="text-[2rem]">
          What is Qloo, what is a language model, what is our code
        </h2>
        <dl className="grid gap-3 md:grid-cols-3">
          {WHO.map((w) => (
            <div key={w.what} className="rounded-md border-2 border-ink bg-card p-4">
              <dt className="text-xl font-bold">{w.what}</dt>
              <dd className="mt-1">{w.items}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="qloo" className="flex flex-col gap-4">
        <h2 id="qloo" className="text-[2rem]">
          Every Qloo call, and why
        </h2>
        <p className="max-w-[68ch]">
          All calls go through one client that paces them, retries once, caches them and logs each one. The counts below come from that log ({total} calls so far), not from a script. The picks page shows the exact calls behind each score.
        </p>
        <div className="overflow-x-auto rounded-md border-2 border-ink bg-card">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <caption className="sr-only">Qloo endpoints the app uses</caption>
            <thead className="border-b-2 border-ink">
              <tr>
                <th scope="col" className="p-3">Stage</th>
                <th scope="col" className="p-3">Endpoint</th>
                <th scope="col" className="p-3">Asks for</th>
                <th scope="col" className="p-3">Why</th>
                <th scope="col" className="p-3 text-right">Calls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.purpose} className="border-b border-rule align-top last:border-0">
                  <th scope="row" className="p-3 font-bold">{row.stage}</th>
                  <td className="p-3">{row.endpoint}</td>
                  <td className="p-3">{row.filter}</td>
                  <td className="p-3">{row.why}</td>
                  <td className="p-3 text-right">{row.calls > 0 ? `${row.calls}${row.avgMs !== null ? `, ${row.avgMs} ms avg` : ""}` : "not called yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="score" className="flex flex-col gap-4">
        <h2 id="score" className="text-[2rem]">
          The club score
        </h2>
        <p className="max-w-[68ch]">A fixed formula, not a model&apos;s opinion. The weights are below, and each part comes with a reason and the Qloo calls behind it.</p>
        <div className="overflow-x-auto rounded-md border-2 border-ink bg-card">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Parts of the club score</caption>
            <thead className="border-b-2 border-ink">
              <tr>
                <th scope="col" className="p-3">Part</th>
                <th scope="col" className="p-3">Weight</th>
                <th scope="col" className="p-3">What it measures</th>
              </tr>
            </thead>
            <tbody>
              {SCORE.map(([name, weight, text]) => (
                <tr key={name} className="border-b border-rule last:border-0">
                  <th scope="row" className="p-3 font-bold">{name}</th>
                  <td className="p-3">{weight}</td>
                  <td className="p-3">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="privacy" className="flex max-w-[68ch] flex-col gap-3">
        <h2 id="privacy" className="text-[2rem]">
          Privacy
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>Guests give a first name or a nickname. No email, no phone number.</li>
          <li>Qloo receives only entity ids, tag ids and coordinates. A guest&apos;s name never leaves our database.</li>
          <li>The language model receives only numbers and tag names for a whole room, never a name or one person&apos;s picks.</li>
          <li>A cookie recognises a returning guest only if they tick the box. It holds a random code, nothing else.</li>
          <li>&quot;Forget me&quot; on the check-in confirmation deletes the guest and every check-in linked to them.</li>
        </ul>
      </section>

      <section aria-labelledby="limits" className="flex max-w-[68ch] flex-col gap-3">
        <h2 id="limits" className="text-[2rem]">
          What it does not claim
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>Qloo&apos;s film, music, TV, book and podcast taste is city-wide. What makes a pick local is the places near the venue, the venue&apos;s own tags and the popularity band, and the evidence drawer shows which calls those were.</li>
          <li>The demo venue is fictional and its four weeks are simulated, seated by the real seating code. Every page that shows them says so.</li>
          <li>Trivia is drafted by a language model and marked &quot;Check before use&quot;.</li>
          <li>The free language model tiers are sometimes busy. When no model answers, the page says the wording came from a template. The numbers and decisions never depend on the model.</li>
          <li>Showing a whole film in public needs a licence. The kit never plans a screening and adds a licence note if any text mentions one.</li>
        </ul>
      </section>

      <p className="max-w-[68ch]">
        Source code and setup: <a href={REPO_URL}>{REPO_URL}</a>. MIT licence.
      </p>
    </div>
  );
}
