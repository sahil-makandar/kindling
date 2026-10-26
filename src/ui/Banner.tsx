import type { ReactNode } from "react";
import { cx } from "./cx";

// "fixture": full-width strip shown when the app runs on recorded sample data.
// "simulated": dotted box around any simulated numbers (CLAUDE.md section 11).
export function Banner({
  variant,
  children,
  className,
}: {
  variant: "fixture" | "simulated";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cx(
        "text-sm font-bold text-ink",
        variant === "fixture" && "w-full bg-marigold px-4 py-2 text-center text-base",
        variant === "simulated" && "rounded-md border-2 border-dotted border-ink bg-card px-3 py-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
