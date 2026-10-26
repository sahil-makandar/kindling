import { cx } from "./cx";

export function StatTile({
  value,
  label,
  delta,
  deltaTone = "neutral",
}: {
  value: string | number;
  label: string;
  delta?: string;
  deltaTone?: "up" | "down" | "neutral";
}) {
  return (
    <div className="rounded-md border-2 border-ink bg-card p-4">
      <p className="font-poster text-6xl font-black leading-none">{value}</p>
      <p className="mt-2 text-sm text-ink-soft">{label}</p>
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
