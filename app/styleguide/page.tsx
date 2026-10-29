import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { COLORS } from "@/src/config/brand";
import { Banner } from "@/src/ui/Banner";
import { Button } from "@/src/ui/Button";
import { Card } from "@/src/ui/Card";
import { Chip } from "@/src/ui/Chip";
import { EmptyState } from "@/src/ui/EmptyState";
import { FlyerCard } from "@/src/ui/FlyerCard";
import { ScoreBar } from "@/src/ui/ScoreBar";
import { Spinner } from "@/src/ui/Spinner";
import { StatTile } from "@/src/ui/StatTile";
import { Tabs } from "@/src/ui/Tabs";
import { DrawerDemo } from "./DrawerDemo";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false },
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="mb-4 text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export default function StyleguidePage() {
  // Dev only: a reference page for the design tokens and components.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div>
      <h1 className="text-[2.75rem]">Styleguide</h1>
      <p className="mt-2 max-w-[68ch] text-ink-soft">
        Every shared component in one place. This page only exists in development.
      </p>

      <Section title="Colour">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Object.entries(COLORS).map(([name, hex]) => (
            <div key={name} className="rounded-md border-2 border-ink bg-card">
              <div className="h-14 border-b-2 border-ink" style={{ backgroundColor: hex }} />
              <p className="p-2 text-sm">
                <span className="font-bold">{name}</span>
                <br />
                {hex}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <Card className="space-y-3">
          <p className="font-display text-[2.75rem] leading-tight">Bricolage Grotesque for page titles</p>
          <p className="font-poster text-7xl font-black leading-none">87 BIG SHOULDERS</p>
          <p className="max-w-[68ch]">
            Atkinson Hyperlegible for body text and the interface. It is built so similar letters
            look different, which helps everyone read.
          </p>
          <p className="text-sm text-ink-soft">Small, secondary text uses ink-soft.</p>
        </Card>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-4">
          <Button variant="cta">Find my clubs</Button>
          <Button variant="primary">Make this our club</Button>
          <Button variant="secondary">Copy listing</Button>
          <Button variant="secondary" disabled>
            Disabled
          </Button>
          <Button href="/" variant="secondary">
            Link button
          </Button>
        </div>
      </Section>

      <Section title="Chips and stamps">
        <div className="flex flex-wrap items-center gap-4">
          <Chip>Music</Chip>
          <Chip>Film</Chip>
          <Chip variant="stamp">Listening night</Chip>
          <Chip variant="stamp">Simulated</Chip>
        </div>
      </Section>

      <Section title="Flyer cards">
        <div className="grid gap-8 sm:grid-cols-2">
          <FlyerCard title="Ghibli and Ramen Night" stamp="Film club" score={87} tilt="left">
            <p className="mb-3">
              This area loves Studio Ghibli and Japanese comfort food more than most places.
            </p>
            <ScoreBar label="Local affinity" value={0.91} />
            <ScoreBar label="Coherence" value={0.74} />
          </FlyerCard>
          <FlyerCard title="Soul and Natural Wine" stamp="Listening night" score={79} tilt="right">
            <p>Not enough data yet to score every part. Missing parts count as low, not as errors.</p>
          </FlyerCard>
        </div>
      </Section>

      <Section title="Stat tiles">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile value={21} label="People came" delta="up 5 on last week" deltaTone="up" />
          <StatTile value="10" label="Came back" />
          <StatTile value={3} label="Regulars made" delta="down 1" deltaTone="down" />
          <StatTile value="9" label="Strangers seated together" delta="same as last week" />
        </div>
      </Section>

      <Section title="Banners">
        <div className="space-y-4">
          <Banner variant="fixture">
            Sample data mode. These results come from recorded examples, not live Qloo calls.
          </Banner>
          <Banner variant="simulated">Simulated weeks for the demo venue.</Banner>
        </div>
      </Section>

      <Section title="Score bars">
        <Card>
          <ScoreBar label="Local affinity" value={0.82} />
          <ScoreBar label="Coherence" value={0.6} />
          <ScoreBar label="Venue fit" value={0.35} />
          <ScoreBar label="Momentum" value={0.05} />
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs
          tabs={[
            { id: "poster", label: "Poster", content: <p>Poster goes here.</p> },
            { id: "run", label: "Run of show", content: <p>Run of show goes here.</p> },
            { id: "listing", label: "Listing", content: <p>Listing copy goes here.</p> },
          ]}
        />
      </Section>

      <Section title="Drawer">
        <DrawerDemo />
      </Section>

      <Section title="Empty state and spinner">
        <div className="grid gap-6 sm:grid-cols-2">
          <EmptyState
            title="No sessions yet"
            action={<Button variant="primary">Open the first night</Button>}
          >
            Once your club has run for a week, attendance shows up here.
          </EmptyState>
          <Card className="flex items-center justify-center">
            <Spinner label="Reading what your neighbourhood loves" />
          </Card>
        </div>
      </Section>
    </div>
  );
}
