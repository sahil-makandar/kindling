import { APP_NAME, TAGLINE } from "@/src/config/brand";
import { Ember } from "@/src/ui/Ember";
import { PeopleAtTable } from "@/src/ui/Illustrations";
import { Button } from "@/src/ui/Button";
import { LandingForm } from "@/src/ui/LandingForm";

const STEPS = [
  { title: "Read the neighbourhood", body: "Qloo shows what your city loves in film, music, books and food, what places within a kilometre of your door are known for, and what your venue's own crowd likes. " + APP_NAME + " keeps the evidence." },
  { title: "Design the club", body: "The agent builds clubs this block over-indexes on, scores each one with a plain formula, and writes the poster, the run of show and the listing." },
  { title: "Bring them back", body: "People check in with a QR code and tap three favourites. " + APP_NAME + " seats strangers who share a taste, then re-tunes the plan every week." },
] as const;

export default function Home() {
  return (
    <div className="flex flex-col gap-16">
      <section className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div className="flex flex-col gap-5 lg:pt-4">
          <div className="flex items-end gap-4">
            <Ember mood="waving" size={84} />
            <p className="rounded-full border-2 border-ink bg-marigold px-4 py-1 text-sm font-bold">{TAGLINE}</p>
          </div>
          <h1 className="max-w-[16ch] text-[2.75rem] sm:text-[3.5rem]">Turn your quietest night into your neighbourhood&apos;s favourite club.</h1>
          <p className="max-w-[56ch] text-lg text-ink-soft">
            Tell us where your venue is. {APP_NAME} reads what people near you love, designs a weekly night around it, and seats strangers by shared taste so they come back as regulars.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button href="#start" variant="cta" className="text-lg">
              Start with your venue
            </Button>
            <Button href="/sample" variant="secondary">
              Explore a sample venue
            </Button>
          </div>
          <p className="text-sm text-ink-soft">Takes about two minutes. No sign-up. The sample is The Lantern Room, a fictional venue with four simulated weeks, so you can see the weekly loop without waiting a month.</p>
          <PeopleAtTable className="mt-2 hidden w-full max-w-md lg:block" />
        </div>
        <div id="start" className="scroll-mt-6">
          <LandingForm />
        </div>
      </section>

      <section aria-labelledby="steps-title">
        <h2 id="steps-title" className="text-[2rem]">
          How it works
        </h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="rounded-lg border-2 border-ink bg-card p-5 shadow-hard transition-transform duration-200 hover:-translate-y-1 hover:rotate-1">
              <p className="font-poster text-5xl font-black leading-none text-ember-ink" aria-hidden="true">
                {i + 1}
              </p>
              <h3 className="mt-3 text-2xl">{step.title}</h3>
              <p className="mt-2 text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="why-title" className="grid gap-8 md:grid-cols-[auto_1fr] md:items-center">
        <p className="font-poster text-[7rem] font-black leading-none text-ember-ink" aria-hidden="true">
          50
        </p>
        <div>
          <h2 id="why-title" className="text-[2rem]">
            Friends take about 50 hours
          </h2>
          <p className="mt-3 max-w-[60ch] text-lg">
            One-off events cannot build a friendship. The same people, in the same place, every week can. One in six people is lonely (WHO), and Mondays and Tuesdays are the nights venues struggle to fill.
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Source: Jeffrey Hall, 2018,{" "}
            <a href="https://news.ku.edu/2018/03/06/study-reveals-number-hours-it-takes-make-friend">
              https://news.ku.edu/2018/03/06/study-reveals-number-hours-it-takes-make-friend
            </a>
          </p>
        </div>
      </section>
    </div>
  );
}
