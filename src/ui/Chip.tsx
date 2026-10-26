import type { ReactNode } from "react";
import { cx } from "./cx";

// "chip" is a small pill for tags. "stamp" is the rubber-stamp look for formats and status.
export function Chip({
  children,
  variant = "chip",
  className,
}: {
  children: ReactNode;
  variant?: "chip" | "stamp";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-block whitespace-nowrap font-bold uppercase text-ink",
        variant === "chip"
          ? "rounded-full border-[1.5px] border-ink px-3 py-0.5 text-xs tracking-wide"
          : "-rotate-3 rounded-sm border-2 border-ink px-2 py-0.5 text-xs tracking-[0.15em]",
        className,
      )}
    >
      {children}
    </span>
  );
}
