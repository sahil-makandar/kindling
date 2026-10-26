import { cx } from "./cx";

// value is 0 to 1. Shown as a whole number out of 100. Pass onSelect to make the
// row a button that opens its evidence.
export function ScoreBar({
  label,
  value,
  onSelect,
  className,
}: {
  label: string;
  value: number;
  onSelect?: () => void;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const shown = Math.round(clamped * 100);
  const row = (
    <>
      <span className="w-32 shrink-0 text-left text-sm">{label}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        className="h-2 flex-1 rounded-full bg-rule"
      >
        <span
          className="block h-full rounded-full bg-ink"
          style={{ width: `${shown}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-sm font-bold">{shown}</span>
    </>
  );
  const shared = "flex w-full items-center gap-3";
  return onSelect ? (
    <button
      type="button"
      onClick={onSelect}
      className={cx(shared, "rounded-sm py-1 hover:bg-paper", className)}
    >
      {row}
    </button>
  ) : (
    <div className={cx(shared, "py-1", className)}>{row}</div>
  );
}
