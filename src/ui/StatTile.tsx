import { CountUp } from "./CountUp";
import { cx } from "./cx";

export function StatTile({
  value,
  label,
  delta,
  deltaTone = "neutral",
  hero = false,
  suffix,
}: {
  value: string | number;
  label: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
  hero?: boolean;
  suffix?: string;
}) {
  return (
    <div className={cx("rounded-lg border-2 border-ink p-4 shadow-hard", hero ? "bg-marigold" : "bg-card")}>
      <p className={cx("font-poster font-extrabold leading-none", hero ? "text-7xl" : "text-5xl")}>
        {typeof value === "number" ? <CountUp value={value} suffix={suffix} /> : value}
      </p>
      <p className={cx("mt-2 text-sm", hero ? "text-ink" : "text-ink-soft")}>{label}</p>
      {delta && (
        <p
          className={cx(
            "mt-1 text-sm font-bold",
            deltaTone === "up" && "text-sage",
            deltaTone === "down" && "text-plum",
            deltaTone === "neutral" && "text-ink-soft",
          )}
        >
          {delta}
        </p>
      )}
    </div>
  );
}
