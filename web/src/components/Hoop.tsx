import { useMemo } from "react";

/**
 *  The dreamcatcher.
 *
 *  A star-polygon weave: N points on a ring, each joined to the point k ahead,
 *  which lays a dense lattice rather than a drawn circle. The ring is the
 *  position; the weave tightens and warms as the account descends dreamDEX's
 *  ladder, and a strand already cut stays visibly severed.
 *
 *  Everything is derived from the margin rung and the cuts spent. Nothing here
 *  is decoration that does not mean something.
 */

const RUNGS = ["Healthy", "Margin call", "Partial liquidation", "Close out"] as const;
const RUNG_COLOR = ["#7a7af0", "#f0bd66", "#f5731f", "#ff7c85"] as const;

export interface HoopProps {
  /** 0 Healthy · 1 MarginCall · 2 PartialLiquidation · 3 CloseOut */
  status: number;
  cutsMade: number;
  cutsTotal: number;
  centre?: string;
  centreLabel?: string;
  /** No watch armed: the weave hangs loose and pale. */
  dormant?: boolean;
}

const SIZE = 320;
const C = SIZE / 2;
const POINTS = 48;

export function Hoop({ status, cutsMade, cutsTotal, centre, centreLabel, dormant }: HoopProps) {
  const rung = Math.max(0, Math.min(3, status));
  const colour = RUNG_COLOR[rung];

  // A tighter weave as the account descends: the lattice pulls inward and the
  // chords reach further around the ring.
  const tension = dormant ? 0 : rung / 3;
  const outer = 128;
  const inner = outer - 18 - tension * 10;
  const skip = 17 + Math.round(tension * 2);

  const chords = useMemo(() => {
    const pts = (r: number) =>
      Array.from({ length: POINTS }, (_, i) => {
        const a = (i / POINTS) * Math.PI * 2 - Math.PI / 2;
        return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
      });
    const o = pts(outer);
    const n = pts(inner);
    return Array.from({ length: POINTS }, (_, i) => ({
      i,
      from: o[i],
      to: n[(i + skip) % POINTS],
    }));
  }, [inner, skip]);

  // Which strands read as severed, spread around the ring so a half-spent
  // budget looks half-spent rather than clustered.
  const severed = useMemo(() => {
    const s = new Set<number>();
    if (cutsTotal <= 0) return s;
    for (let i = 0; i < Math.min(cutsMade, cutsTotal); i++) {
      const at = Math.round((i * POINTS) / cutsTotal);
      for (let d = -1; d <= 1; d++) s.add((at + d + POINTS) % POINTS);
    }
    return s;
  }, [cutsMade, cutsTotal]);

  return (
    <svg
      className="hoop"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Margin ${RUNGS[rung]}, ${cutsMade} of ${cutsTotal} strands cut`}
    >
      <defs>
        <radialGradient id="hoopGlow" cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor={colour} stopOpacity="0" />
          <stop offset="100%" stopColor={colour} stopOpacity={dormant ? 0.06 : 0.13} />
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r={outer + 6} fill="url(#hoopGlow)" />

      <g fill="none" strokeLinecap="round">
        {chords.map(({ i, from, to }) => {
          const cut = severed.has(i);
          return (
            <line
              key={i}
              x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]}
              stroke={cut ? "#ff7c85" : colour}
              strokeOpacity={cut ? 0.16 : dormant ? 0.4 : 0.62}
              strokeWidth={cut ? 0.6 : 1}
              strokeDasharray={cut ? "2 6" : undefined}
            />
          );
        })}
      </g>

      {/* The rim, drawn over the weave so the ring reads as one object. */}
      <circle cx={C} cy={C} r={outer} fill="none" stroke={colour}
              strokeOpacity={dormant ? 0.22 : 0.4} strokeWidth="1" />

      {centre && (
        <text x={C} y={C + 4} textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
              fontSize="34" fontWeight="600" fill="#f4f4f7" letterSpacing="-1">
          {centre}
        </text>
      )}
      {centreLabel && (
        <text x={C} y={C + 28} textAnchor="middle"
              fontFamily="'JetBrains Mono', ui-monospace, monospace"
              fontSize="11" letterSpacing="2" fill="#8d98a3">
          {centreLabel.toUpperCase()}
        </text>
      )}
    </svg>
  );
}

export const rungName = (s: number) => RUNGS[Math.max(0, Math.min(3, s))];
export const rungColour = (s: number) => RUNG_COLOR[Math.max(0, Math.min(3, s))];
export const RUNG_LADDER = RUNGS;
