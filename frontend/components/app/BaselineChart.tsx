import type { Series } from "@/lib/demo";

/**
 * A senior's own normal range, and the line that drifts off it.
 *
 * The brief is explicit that deviation from a senior's own baseline matters
 * more than population averages, so the band here is a rolling median and MAD
 * for this person — computed excluding today, so an extreme reading cannot
 * drag its own baseline — and never a fixed clinical threshold.
 *
 * Colour appears at exactly one place: where the trace leaves the band. A
 * missing day is drawn as a gap and never interpolated, because a reading that
 * never arrived is evidence rather than a hole to fill.
 *
 * Server component, pure SVG, no script.
 */
export function BaselineChart({ series }: { series: Series }) {
  const { values, band, breachAt, label, unit } = series;
  const W = 720;
  const H = 240;
  const pad = { top: 24, right: 20, bottom: 32, left: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const present = values.filter((v): v is number => v !== null);
  const lo = Math.min(...present, band[0]);
  const hi = Math.max(...present, band[1]);
  const span = hi - lo || 1;
  const margin = span * 0.16;

  const x = (i: number) => pad.left + (i / (values.length - 1)) * plotW;
  const y = (v: number) =>
    pad.top + plotH - ((v - (lo - margin)) / (span + margin * 2)) * plotH;

  const bandTop = y(band[1]);
  const bandBottom = y(band[0]);

  // Split into runs so a missing day becomes a real gap.
  const runs: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v });
    }
  });
  if (run.length) runs.push(run);

  const lastIndex = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const lastValue = values[lastIndex];
  const daysOut = values.length - breachAt;

  return (
    <figure className="bchart">
      <figcaption className="bchart__cap">
        <span>
          <strong>{label}</strong>
          <span className="bchart__unit">
            {unit} · {values.length} days · her band {band[0]}–{band[1]}
          </span>
        </span>
        <span className="bchart__key">
          <i className="bchart__sw bchart__sw--band" /> her own normal
          <i className="bchart__sw bchart__sw--out" /> above it
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${label} over ${values.length} days. Readings sit inside her own normal range of ${band[0]} to ${band[1]} ${unit} for ${breachAt} days, then rise above it and stay above it for ${daysOut} days. One day has no reading and is shown as a gap.`}
      >
        <rect
          x={pad.left}
          y={bandTop}
          width={plotW}
          height={Math.max(2, bandBottom - bandTop)}
          fill="var(--sage)"
        />
        <line x1={pad.left} y1={bandTop} x2={W - pad.right} y2={bandTop} stroke="var(--line-2)" />
        <line x1={pad.left} y1={bandBottom} x2={W - pad.right} y2={bandBottom} stroke="var(--line-2)" />

        {runs.map((r, ri) => {
          const inside = r.filter((p) => p.i <= breachAt);
          const outside = r.filter((p) => p.i >= breachAt);
          return (
            <g key={ri}>
              {inside.length > 1 && (
                <polyline
                  points={inside.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                  fill="none"
                  stroke="var(--forest)"
                  strokeWidth="2"
                />
              )}
              {outside.length > 1 && (
                <polyline
                  points={outside.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                  fill="none"
                  stroke="var(--risk-high)"
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}

        <line
          x1={x(breachAt)}
          y1={pad.top}
          x2={x(breachAt)}
          y2={pad.top + plotH}
          stroke="var(--line-2)"
          strokeDasharray="3 4"
        />
        <text x={x(breachAt) + 7} y={pad.top + 11} className="bchart__tick">
          leaves band
        </text>

        {lastValue != null && (
          <circle cx={x(lastIndex)} cy={y(lastValue)} r="4.5" fill="var(--risk-high)" />
        )}

        <text x={pad.left} y={H - 10} className="bchart__tick">Day 01</text>
        <text x={W - pad.right} y={H - 10} textAnchor="end" className="bchart__tick">
          Day {values.length}
        </text>
        <text x="6" y={bandTop + 4} className="bchart__tick">{band[1]}</text>
        <text x="6" y={bandBottom + 4} className="bchart__tick">{band[0]}</text>
      </svg>

      <style>{`
        .bchart { margin: 0; }
        .bchart__cap {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: var(--s-4); flex-wrap: wrap; margin-bottom: var(--s-4);
          font-size: var(--fs-sm);
        }
        .bchart__unit { color: var(--ink-3); margin-left: var(--s-3); }
        .bchart__key {
          display: inline-flex; align-items: center; gap: var(--s-2);
          font-size: var(--fs-xs); color: var(--ink-3);
        }
        .bchart__sw { width: 10px; height: 10px; display: inline-block; border-radius: 2px; }
        .bchart__sw--band { background: var(--sage); border: 1px solid var(--line-2); }
        .bchart__sw--out { background: var(--risk-high); margin-left: var(--s-3); }
        .bchart__tick { font-size: 11px; fill: var(--ink-3); }
        /* SVG text scales with the viewBox, so on a phone the ticks fall to
           about 6px. Drop them; the caption already carries the numbers. */
        @media (max-width: 34rem) { .bchart__tick { display: none; } }
      `}</style>
    </figure>
  );
}
