import type { MoodDay, ScorePoint, VitalPoint } from "@/lib/report";

/**
 * The report's charts, as plain server-rendered SVG.
 *
 * WHY NOT RECHARTS, WHICH IS ALREADY A DEPENDENCY. This page's whole purpose
 * is to be printed and handed over. A charting library measures its container
 * in the browser and draws on mount, so in a print context it can lay out
 * against the screen width and clip, and in a PDF produced before hydration it
 * can be missing altogether. SVG with fixed coordinates has none of those
 * failure modes: it is in the HTML the server sends, it scales with the page,
 * and it prints exactly as it renders.
 *
 * Gaps are drawn as gaps. A senior with no reading on Tuesday gets no point on
 * Tuesday — the line breaks rather than sliding over the hole, because a
 * continuous line through missing data is a claim nobody measured.
 */

const INK = "#16261f";
const MUTED = "#6f7d77";
const LINE = "#e4e8df";

/* ---- vitals ------------------------------------------------------------- */

type Series = { key: keyof VitalPoint; label: string; colour: string };

const VITAL_SERIES: Series[] = [
  { key: "systolic", label: "BP (sys)", colour: "#2f6b8f" },
  { key: "diastolic", label: "BP (dia)", colour: "#7aa6c2" },
  { key: "pulse", label: "Pulse", colour: "#b8862f" },
  { key: "spo2", label: "SpO₂ %", colour: "#2f6b3c" },
];

export function VitalsChart({
  points,
  emptyLabel,
}: {
  points: VitalPoint[];
  emptyLabel: string;
}) {
  if (!points.length) {
    return <p className="rep__empty">{emptyLabel}</p>;
  }

  const W = 520;
  const H = 190;
  const PAD = { l: 34, r: 10, t: 12, b: 26 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const values = points.flatMap((p) =>
    VITAL_SERIES.map((s) => p[s.key] as number | null).filter(
      (v): v is number => v !== null,
    ),
  );
  // Fit the range to the readings rather than pinning it to 40–180. A fixed
  // scale squashes a week of stable vitals into one flat band near the middle,
  // which hides exactly the drift this chart exists to show. Padded by 10 so
  // the lines do not touch the frame, and floored at a 40-unit span so a very
  // steady week is not magnified into fake drama.
  const rawLo = Math.min(...values);
  const rawHi = Math.max(...values);
  const span = Math.max(40, rawHi - rawLo + 20);
  const mid = (rawHi + rawLo) / 2;
  const lo = Math.floor((mid - span / 2) / 10) * 10;
  const hi = Math.ceil((mid + span / 2) / 10) * 10;

  const x = (i: number) =>
    PAD.l + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.t + innerH - ((v - lo) / (hi - lo)) * innerH;

  const ticks = [lo, Math.round((lo + hi) / 2), hi];

  return (
    <figure className="rep__chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vital signs over the week">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth="1" />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill={MUTED}>
              {t}
            </text>
          </g>
        ))}

        {VITAL_SERIES.map((s) => {
          // Each unbroken run of readings is its own path, so a missing day
          // leaves a visible gap instead of an invented straight line.
          const runs: string[] = [];
          let current: string[] = [];
          points.forEach((p, i) => {
            const v = p[s.key] as number | null;
            if (v === null) {
              if (current.length) runs.push(current.join(" "));
              current = [];
              return;
            }
            current.push(`${current.length ? "L" : "M"}${x(i)},${y(v)}`);
          });
          if (current.length) runs.push(current.join(" "));

          return (
            <g key={s.key}>
              {runs.map((d, i) => (
                <path key={i} d={d} fill="none" stroke={s.colour} strokeWidth="1.8" strokeLinecap="round" />
              ))}
              {points.map((p, i) => {
                const v = p[s.key] as number | null;
                return v === null ? null : (
                  <circle key={i} cx={x(i)} cy={y(v)} r="2.6" fill={s.colour} />
                );
              })}
            </g>
          );
        })}

        {points.map((p, i) => (
          <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill={MUTED}>
            {p.date.slice(8)}
          </text>
        ))}
      </svg>

      <figcaption className="rep__legend">
        {VITAL_SERIES.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.colour }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/* ---- wellbeing trend ---------------------------------------------------- */

export function HealthTrend({ series }: { series: ScorePoint[] }) {
  if (series.length < 2) return null;

  const W = 150;
  const H = 44;
  const lo = Math.min(...series.map((s) => s.health)) - 4;
  const hi = Math.max(...series.map((s) => s.health)) + 4;
  const x = (i: number) => (i / (series.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 4 - ((v - lo) / Math.max(1, hi - lo)) * (H - 10);

  const d = series.map((s, i) => `${i ? "L" : "M"}${x(i)},${y(s.health)}`).join(" ");
  const area = `${d} L${x(series.length - 1)},${H} L${x(0)},${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="rep__spark" role="img" aria-label="Wellbeing trend across the week">
      <path d={area} fill="rgba(47,107,60,0.12)" />
      <path d={d} fill="none" stroke="#2f6b3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(series.length - 1)} cy={y(series[series.length - 1].health)} r="3" fill="#2f6b3c" />
    </svg>
  );
}

/* ---- the week of check-ins ---------------------------------------------- */

const FEELING_FILL: Record<number, string> = {
  1: "#2f6b3c",
  2: "#6f9c5a",
  3: "#b8862f",
};

export function MoodWeek({
  days,
  labels,
}: {
  days: MoodDay[];
  /** 1 better · 2 same · 3 worse · 0 no answer. */
  labels: Record<string, string>;
}) {
  return (
    <ul className="rep__mood">
      {days.map((d) => {
        const h = d.feeling ? [0, 100, 68, 44][d.feeling] : 20;
        const fill = d.feeling ? FEELING_FILL[d.feeling] : "transparent";
        const label = d.answered ? labels[String(d.feeling ?? 0)] : labels["0"];
        return (
          <li key={d.date}>
            <span className="rep__moodbar" title={`${d.weekday}: ${label}`}>
              <span
                className={d.answered ? "rep__moodfill" : "rep__moodfill rep__moodfill--none"}
                style={{ height: `${h}%`, background: fill }}
              />
            </span>
            <span className="rep__moodday">{d.weekday}</span>
            <span className="visually-hidden">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---- adherence ---------------------------------------------------------- */

export function AdherenceRing({ taken, due }: { taken: number; due: number }) {
  const pct = due ? Math.round((taken / due) * 100) : 0;
  const R = 34;
  const C = 2 * Math.PI * R;
  const colour = pct >= 85 ? "#2f6b3c" : pct >= 60 ? "#b8862f" : "#ab3320";

  return (
    <svg viewBox="0 0 88 88" className="rep__ring" role="img" aria-label={`${pct}% of doses logged`}>
      <circle cx="44" cy="44" r={R} fill="none" stroke={LINE} strokeWidth="9" />
      <circle
        cx="44"
        cy="44"
        r={R}
        fill="none"
        stroke={colour}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * C} ${C}`}
        transform="rotate(-90 44 44)"
      />
      <text x="44" y="49" textAnchor="middle" fontSize="19" fontWeight="600" fill={INK}>
        {pct}%
      </text>
    </svg>
  );
}
