import type { SessionStats } from "@/src/coach/signals";

const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Check-ins per night with the people who came back stacked below the new faces. Plain SVG, with the numbers also in a
// table for screen readers.
export function WeeklyChart({ nights, baseline }: { nights: ReadonlyArray<SessionStats>; baseline: number | null }) {
  if (nights.length === 0) return null;
  const width = 640;
  const height = 280;
  const pad = { top: 28, right: 16, bottom: 52, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(5, ...nights.map((n) => n.attendance), baseline ?? 0);
  const ceiling = Math.ceil(max / 5) * 5;
  const slot = innerW / nights.length;
  const barW = Math.min(64, slot * 0.6);
  const y = (value: number) => pad.top + innerH - (value / ceiling) * innerH;
  const summary = nights.map((n) => `night ${n.number}: ${n.attendance} check-ins, ${n.returning} had been before`).join("; ");

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Check-ins per night. ${summary}.`} className="h-auto w-full">
        {[0, ceiling / 2, ceiling].map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-rule)" strokeWidth="1" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="12" fill="var(--color-ink-soft)">
              {tick}
            </text>
          </g>
        ))}
        {baseline !== null && (
          <g>
            <line x1={pad.left} x2={width - pad.right} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-ink)" strokeWidth="1.5" strokeDasharray="6 5" />
            <text x={width - pad.right} y={y(baseline) - 6} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--color-ink)">
              A normal night before: {baseline}
            </text>
          </g>
        )}
        {nights.map((night, i) => {
          const x = pad.left + slot * i + (slot - barW) / 2;
          const fresh = night.attendance - night.returning;
          return (
            <g key={night.number}>
              <rect x={x} y={y(night.returning)} width={barW} height={Math.max(0, y(0) - y(night.returning))} fill="var(--color-ink)" />
              <rect x={x} y={y(night.attendance)} width={barW} height={Math.max(0, y(night.returning) - y(night.attendance))} fill="var(--color-marigold)" stroke="var(--color-ink)" strokeWidth="2" />
              <text x={x + barW / 2} y={y(night.attendance) - 8} textAnchor="middle" fontSize="18" fontWeight="900" fontFamily="var(--font-big-shoulders), sans-serif" fill="var(--color-ink)">
                {night.attendance}
              </text>
              <text x={x + barW / 2} y={height - 28} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-ink)">
                Night {night.number}
              </text>
              <text x={x + barW / 2} y={height - 12} textAnchor="middle" fontSize="12" fill="var(--color-ink-soft)">
                {shortDate(night.date)}
              </text>
              <title>{`Night ${night.number}: ${night.attendance} check-ins, ${night.returning} came back, ${fresh} new`}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-3 bg-ink" /> Came back
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-3 w-3 border-2 border-ink bg-marigold" /> New faces
        </span>
      </figcaption>
      <table className="sr-only">
        <caption>Check-ins per night</caption>
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col">Check-ins</th>
            <th scope="col">Came back</th>
          </tr>
        </thead>
        <tbody>
          {nights.map((n) => (
            <tr key={n.number}>
              <th scope="row">{n.number}</th>
              <td>{n.attendance}</td>
              <td>{n.returning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
