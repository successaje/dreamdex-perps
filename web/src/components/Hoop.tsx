import { useMemo } from "react";

/**
 *  The dreamcatcher.
 *
 *  A real dreamcatcher is a hoop with a woven web that catches what is falling
 *  before it reaches the sleeper. Here the web IS the margin: it hangs loose
 *  while the position is healthy and draws tighter as the account descends
 *  dreamDEX's ladder, and a strand that has already been cut stays visibly
 *  severed so the user can see what the watch spent on their behalf.
 *
 *  Everything is derived from one number. Nothing here is decoration that does
 *  not mean something.
 */

const RUNGS = ["Healthy", "Margin call", "Partial liquidation", "Close out"] as const;
const RUNG_COLOR = ["#00fa89", "#f0b429", "#f5731f", "#dc0b4a"] as const;

export interface HoopProps {
  /** 0 Healthy · 1 MarginCall · 2 PartialLiquidation · 3 CloseOut */
  status: number;
  /** Strands already cut, drawn severed. */
  cutsMade: number;
  /** Total strands the watch may ever cut. */
  cutsTotal: number;
  /** Centre line — the position, or whatever the screen is about. */
  centre?: string;
  centreLabel?: string;
  /** Dim everything: no watch is armed, so the web is hanging loose. */
  dormant?: boolean;
}

const SIZE = 320;
const C = SIZE / 2;
const R = 118;
const SPOKES = 12;

/** Classic woven web: each ring is built from the midpoints of the chords of
 *  the ring outside it, pulled inward. Tension decides how far inward. */
function weave(tension: number) {
  const rings: Array<Array<[number, number]>> = [];
  let pts: Array<[number, number]> = [];
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2 - Math.PI / 2;
    pts.push([C + R * Math.cos(a), C + R * Math.sin(a)]);
  }
  rings.push(pts);

  // A tight web pulls each successive ring harder toward the centre.
  const pull = 0.62 - tension * 0.17;
  for (let ring = 0; ring < 4; ring++) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      next.push([C + (mx - C) * (1 - (1 - pull)), C + (my - C) * (1 - (1 - pull))]);
    }
    rings.push(next);
    pts = next;
  }
  return rings;
}

export function Hoop({ status, cutsMade, cutsTotal, centre, centreLabel, dormant }: HoopProps) {
  const rung = Math.max(0, Math.min(3, status));
  const colour = dormant ? "#6e6eed" : RUNG_COLOR[rung];
  // Healthy hangs loose; each rung down draws the web in.
  const tension = dormant ? 0 : rung / 3;

  const rings = useMemo(() => weave(tension), [tension]);

  // Which spokes read as severed. Spread them around the hoop rather than
  // clustering, so a half-spent budget looks half-spent.
  const severed = useMemo(() => {
    const s = new Set<number>();
    if (cutsTotal <= 0) return s;
    for (let i = 0; i < Math.min(cutsMade, SPOKES); i++) {
      s.add(Math.round((i * SPOKES) / Math.max(1, Math.min(cutsTotal, SPOKES))) % SPOKES);
    }
    return s;
  }, [cutsMade, cutsTotal]);

  return (
    <svg className="hoop" viewBox={`0 0 ${SIZE} ${SIZE + 86}`} role="img"
         aria-label={`Margin ${RUNGS[rung]}, ${cutsMade} of ${cutsTotal} strands cut`}>
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={colour} stopOpacity={dormant ? 0.12 : 0.18} />
          <stop offset="70%" stopColor={colour} stopOpacity="0" />
        </radialGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>

      <circle cx={C} cy={C} r={R + 16} fill="url(#glow)" />

      {/* Hanging threads. They sway only when something is actually watching. */}
      {[-46, 0, 46].map((dx, i) => (
        <g key={i} opacity={dormant ? 0.5 : 0.7}>
          <path
            d={`M ${C + dx} ${C + R - 6} Q ${C + dx + (i - 1) * 7} ${C + R + 36} ${C + dx} ${C + R + 62}`}
            stroke={colour} strokeOpacity="0.45" strokeWidth="1.1" fill="none"
          >
            {!dormant && (
              <animate attributeName="stroke-opacity" values="0.2;0.55;0.2"
                       dur={`${3.4 + i * 0.7}s`} repeatCount="indefinite" />
            )}
          </path>
          <circle cx={C + dx} cy={C + R + 64} r="3.1" fill={colour} fillOpacity="0.75" />
        </g>
      ))}

      {/* The web. Outer rings first so inner strands sit on top. */}
      <g strokeLinecap="round" fill="none">
        {rings.map((ring, ri) =>
          ring.map((p, i) => {
            const q = ring[(i + 1) % ring.length];
            const cut = ri === 0 && severed.has(i);
            return (
              <line
                key={`${ri}-${i}`}
                x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
                stroke={cut ? "#dc0b4a" : colour}
                strokeOpacity={cut ? 0.22 : (dormant ? 0.34 : 0.42) - ri * 0.05}
                strokeWidth={cut ? 0.7 : 1.3 - ri * 0.14}
                strokeDasharray={cut ? "3 6" : undefined}
              />
            );
          }),
        )}

        {/* Spokes from the hoop inward — the strands that actually get cut. */}
        {rings[0].map((p, i) => {
          const inner = rings[2][i % rings[2].length];
          const cut = severed.has(i);
          return (
            <line
              key={`spoke-${i}`}
              x1={p[0]} y1={p[1]} x2={inner[0]} y2={inner[1]}
              stroke={cut ? "#dc0b4a" : colour}
              strokeOpacity={cut ? 0.3 : dormant ? 0.26 : 0.3}
              strokeWidth={cut ? 0.8 : 0.9}
              strokeDasharray={cut ? "2 7" : undefined}
            />
          );
        })}
      </g>

      {/* The hoop itself. It breathes while a watch is live. */}
      <circle cx={C} cy={C} r={R} fill="none" stroke={colour}
              strokeOpacity={dormant ? 0.55 : 0.9} strokeWidth="2.4" />
      <circle cx={C} cy={C} r={R} fill="none" stroke={colour}
              strokeOpacity={dormant ? 0.08 : 0.3} strokeWidth="6" filter="url(#soft)">
        {!dormant && (
          <animate attributeName="stroke-opacity" values="0.18;0.42;0.18" dur="4.2s" repeatCount="indefinite" />
        )}
      </circle>

      {centre && (
        <text x={C} y={C - 2} textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
              fontSize="27" fontWeight="700" fill="#ffffff">
          {centre}
        </text>
      )}
      {centreLabel && (
        <text x={C} y={C + 20} textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
              fontSize="10" letterSpacing="1.6" fill="#8d98a3">
          {centreLabel.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

export const rungName = (s: number) => RUNGS[Math.max(0, Math.min(3, s))];
export const rungColour = (s: number) => RUNG_COLOR[Math.max(0, Math.min(3, s))];
