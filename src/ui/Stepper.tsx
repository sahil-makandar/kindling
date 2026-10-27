import Link from "next/link";
import { Check } from "lucide-react";
import type { JourneyLink } from "@/src/journey/journey";
import { cx } from "./cx";

// The five steps of a venue's journey. Finished steps are links. On a phone it is one compact row, on a desktop a vertical list in the left rail.
export function Stepper({ steps, variant }: { steps: JourneyLink[]; variant: "row" | "list" }) {
  return (
    <nav aria-label="Your venue's steps" className={variant === "row" ? "lg:hidden" : "hidden lg:block"}>
      <ol className={variant === "row" ? "grid grid-cols-5 gap-1" : "flex flex-col gap-1"}>
        {steps.map((step, i) => {
          const inner = (
            <>
              <span
                className={cx(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-ink text-sm font-bold",
                  step.state === "current" && "bg-tomato",
                  step.state === "done" && "bg-sage text-card",
                  step.state === "todo" && "bg-card text-ink-soft",
                )}
              >
                {step.state === "done" ? <Check aria-hidden="true" size={16} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cx(variant === "row" ? "text-center text-xs leading-tight" : "text-base leading-tight", step.state === "current" ? "font-bold text-ink" : "text-ink-soft")}>
                {variant === "row" ? step.short : step.label}
              </span>
            </>
          );
          const shared = cx("flex items-center gap-2 rounded-md p-1.5", variant === "row" ? "flex-col" : "");
          return (
            <li key={step.key}>
              {step.href ? (
                <Link href={step.href} className={cx(shared, "text-ink no-underline hover:bg-peach")}>
                  {inner}
                </Link>
              ) : (
                <span className={cx(shared, step.state === "current" && "bg-peach")} aria-current={step.state === "current" ? "step" : undefined}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
