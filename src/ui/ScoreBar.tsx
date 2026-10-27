import { cx } from "./cx";

// value is 0 to 1. Shown as a whole number out of 100. Pass onSelect to make the
// row a button that opens its evidence. scope says how far the number reaches ("places within 1 km").
export function ScoreBar({
  label,
  scope,
  value,
  onSelect,
  className,
}: {
  label: string;
  scope?: string;
  value: number;
  onSelect?: () => void;
  className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const shown = Math.round(clamped * 100);
  const row = (
    <>
      <span className="w-36 shrink-0 text-left text-sm leading-tight">
        {label}
        {scope && <span className="block text-xs text-ink-soft">{scope}</span>}
      </span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        className="h-3 flex-1 rounded-full bg-rule"
      >
        <span className="block h-full rounded-full bg-tomato" style={{ width: `${shown}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right text-sm font-bold">{shown}</span>
    </>
  );
  const shared = "flex w-full items-center gap-3";
  return onSelect ? (
    <button type="button" onClick={onSelect} className={cx(shared, "rounded-md py-1 hover:bg-peach/60", className)}>
      {row}
    </button>
  ) : (
    <div className={cx(shared, "py-1", className)}>{row}</div>
  );
}
