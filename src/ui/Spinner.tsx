import { Ember } from "./Ember";
import { cx } from "./cx";

// Ember looks up and bobs while something loads.
export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cx("inline-flex items-center gap-3", className)}>
      <Ember mood="thinking" size={36} />
      <span className="text-sm text-ink-soft">{label}</span>
    </span>
  );
}
