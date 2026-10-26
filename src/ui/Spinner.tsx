import { cx } from "./cx";

// A small stamp that presses down on a line, over and over.
export function Spinner({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-3", className)}>
      <span aria-hidden="true" className="relative inline-block h-8 w-8">
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />
        <span className="absolute inset-x-1 top-0 h-5 animate-stamp rounded-sm border-2 border-tomato bg-card" />
      </span>
      <span className="text-sm text-ink-soft">{label}</span>
    </span>
  );
}
