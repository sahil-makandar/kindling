import type { ReactNode } from "react";
import { Chip } from "./Chip";
import { cx } from "./cx";

// A club pick pinned to the noticeboard: tape strip, slight tilt, stamped format, big score.
export function FlyerCard({
  title,
  stamp,
  score,
  tilt = "left",
  children,
  className,
}: {
  title: string;
  stamp?: string;
  score?: number | string;
  tilt?: "left" | "right";
  children?: ReactNode;
  className?: string;
}) {
  return (
    <article
      style={{ ["--tilt" as string]: tilt === "left" ? "-1deg" : "1deg" }}
      className={cx(
        "relative animate-pin rounded-lg border-2 border-ink bg-card p-5 pt-8 shadow-hard transition-transform duration-200 hover:-translate-y-1 hover:rotate-0",
        tilt === "left" ? "-rotate-1" : "rotate-1",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute -top-3 left-1/2 h-6 w-24 -translate-x-1/2 rotate-2 bg-marigold/90"
      />
      {score !== undefined && (
        <p
          className="absolute right-4 top-4 font-poster text-5xl font-black leading-none text-ember-ink"
          aria-label={`Score ${score}`}
        >
          {score}
        </p>
      )}
      <h3 className="pr-16 text-2xl">{title}</h3>
      {stamp && <Chip variant="stamp" className="mt-3">{stamp}</Chip>}
      {children && <div className="mt-4">{children}</div>}
    </article>
  );
}
