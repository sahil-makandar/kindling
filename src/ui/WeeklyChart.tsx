import type { SessionStats } from "@/src/coach/signals";

const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Check-ins per night, split into people who had been before (green, at the bottom) and new faces (peach, on top). The
// bars are labelled directly, with no legend, and both axes have titles. Plain SVG, with the numbers also in a table for
// screen readers.
export function WeeklyChart({ nights, baseline }: { nights: ReadonlyArray<SessionStats>; baseline: number | null }) {
  if (nights.length === 0) return null;
  const width = 520;
  const height = 320;
  const pad = { top: 34, right: 104, bottom: 64, left: 56 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = Math.max(5, ...nights.map((n) => n.attendance), baseline ?? 0);
  const ceiling = Math.ceil(max / 5) * 5;
  const slot = innerW / nights.length;
  const barW = Math.min(72, slot * 0.62);
  const y = (value: number) => pad.top + innerH - (value / ceiling) * innerH;
  const last = nights[nights.length - 1];
  const lastX = pad.left + slot * (nights.length - 1) + (slot - barW) / 2 + barW;
  const summary = nights.map((n) => `night ${n.number}: ${n.attendance} check-ins, ${n.returning} had been before`).join("; ");

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Guests per night, split into people who came back and new faces. ${summary}.`} className="h-auto w-full">
        {[0, ceiling / 2, ceiling].map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-rule)" strokeWidth="1.5" />
            <text x={pad.left - 10} y={y(tick) + 6} textAnchor="end" fontSize="17" fill="var(--color-ink-soft)">
              {tick}
            </text>
          </g>
        ))}
        <text transform={`translate(16 ${pad.top + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--color-ink)">
          Guests
        </text>
        {baseline !== null && (
          <g>
            <line x1={pad.left} x2={width - pad.right} y1={y(baseline)} y2={y(baseline)} stroke="var(--color-ink)" strokeWidth="2" strokeDasharray="7 6" />
            <text x={width - pad.right + 8} y={y(baseline) + 5} fontSize="14" fontWeight="700" fill="var(--color-ink)">
              Your usual
            </text>
            <text x={width - pad.right + 8} y={y(baseline) + 21} fontSize="14" fontWeight="700" fill="var(--color-ink)">
              night: {baseline}
            </text>
          </g>
        )}
        {nights.map((night, i) => {
          const x = pad.left + slot * i + (slot - barW) / 2;
          const fresh = night.attendance - night.returning;
          return (
            <g key={night.number}>
              <rect x={x} y={y(night.returning)} width={barW} height={Math.max(0, y(0) - y(night.returning))} rx="6" fill="var(--color-sage)" stroke="var(--color-ink)" strokeWidth="2.5" />
              <rect x={x} y={y(night.attendance)} width={barW} height={Math.max(0, y(night.returning) - y(night.attendance))} rx="6" fill="var(--color-peach)" stroke="var(--color-ink)" strokeWidth="2.5" />
              {night.returning > 0 && y(0) - y(night.returning) > 24 && (
                <text x={x + barW / 2} y={(y(0) + y(night.returning)) / 2 + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="#FFFCF6">
                  {night.returning}
                </text>
              )}
              {fresh > 0 && y(night.returning) - y(night.attendance) > 24 && (
                <text x={x + barW / 2} y={(y(night.returning) + y(night.attendance)) / 2 + 6} textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--color-ink)">
                  {fresh}
                </text>
              )}
              <text x={x + barW / 2} y={y(night.attendance) - 9} textAnchor="middle" fontSize="22" fontWeight="800" fontFamily="var(--font-bricolage), sans-serif" fill="var(--color-ink)">
                {night.attendance}
              </text>
              <text x={x + barW / 2} y={height - 36} textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--color-ink)">
                Night {night.number}
              </text>
              <text x={x + barW / 2} y={height - 17} textAnchor="middle" fontSize="15" fill="var(--color-ink-soft)">
                {shortDate(night.date)}
              </text>
              <title>{`Night ${night.number}: ${night.attendance} check-ins, ${night.returning} came back, ${fresh} new`}</title>
            </g>
          );
        })}
        {/* Direct labels on the last bar, in place of a legend. */}
        {last.returning > 0 && (
          <text x={lastX + 10} y={(y(0) + y(last.returning)) / 2 + 5} fontSize="15" fontWeight="700" fill="var(--color-sage)">
            Came back
          </text>
        )}
        {last.attendance - last.returning > 0 && (
          <text x={lastX + 10} y={(y(last.returning) + y(last.attendance)) / 2 + 5} fontSize="15" fontWeight="700" fill="var(--color-ember-ink)">
            New faces
          </text>
        )}
        <text x={pad.left + innerW / 2} y={height - 1} textAnchor="middle" fontSize="12" fill="var(--color-ink-soft)">
          Nights, oldest on the left
        </text>
      </svg>
      <table className="sr-only">
        <caption>Guests per night</caption>
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col">Guests</th>
            <th scope="col">Came back</th>
            <th scope="col">New</th>
          </tr>
        </thead>
        <tbody>
          {nights.map((n) => (
            <tr key={n.number}>
              <th scope="row">{n.number}</th>
              <td>{n.attendance}</td>
              <td>{n.returning}</td>
              <td>{n.attendance - n.returning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
