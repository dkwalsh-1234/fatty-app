'use client';

// Weight trend (Goal screen): weigh-ins as ink 2 dots, the trend line in ink, the on-pace line
// dashed in ink 3, the goal as a horizontal accent line. Lines are also told apart by dash and
// direct labels, never colour alone. Tap or hover for a reading.

import { useMemo, useRef, useState } from 'react';
import { daysBetween, shortDate } from '@/lib/dates';
import { kg } from '@/lib/format';

export interface WeightPoint {
  date: string; // local date
  kg: number;
}

/** Exponentially smoothed trend, one value per weigh-in (time-aware: a long gap counts more). */
export function trend(points: WeightPoint[], halfLifeDays = 7): number[] {
  const out: number[] = [];
  let t = points[0]?.kg ?? 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      out.push(t);
      continue;
    }
    const gap = Math.max(1, daysBetween(points[i - 1].date, points[i].date));
    const a = 1 - Math.pow(0.5, gap / halfLifeDays);
    t = t + a * (points[i].kg - t);
    out.push(t);
  }
  return out;
}

const W = 340;
const H = 200;
const pad = { l: 34, r: 12, t: 14, b: 24 };

export function WeightChart({ points, goal, today }: {
  points: WeightPoint[];
  goal: { startDate: string; startKg: number; targetDate: string; targetKg: number } | null;
  today: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const g = useMemo(() => {
    const from = goal ? (points[0] && points[0].date < goal.startDate ? points[0].date : goal.startDate) : (points[0]?.date ?? today);
    const to = goal ? (goal.targetDate > today ? goal.targetDate : today) : today;
    const span = Math.max(1, daysBetween(from, to));
    const ys = [...points.map((p) => p.kg), ...(goal ? [goal.startKg, goal.targetKg] : [])];
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (!isFinite(lo)) {
      lo = 60;
      hi = 80;
    }
    const padKg = Math.max(0.5, (hi - lo) * 0.12);
    lo = Math.floor(lo - padKg);
    hi = Math.ceil(hi + padKg);
    const x = (d: string) => pad.l + (daysBetween(from, d) / span) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
    const step = Math.max(1, Math.ceil((hi - lo) / 4));
    const ticks: number[] = [];
    for (let v = Math.ceil(lo); v <= hi; v += step) ticks.push(v);
    const tr = trend(points);
    return { from, to, x, y, ticks, tr };
  }, [points, goal, today]);

  function onMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg || !points.length) return;
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(g.x(points[i].date) - px) < Math.abs(g.x(points[best].date) - px)) best = i;
    setHover(best);
  }

  const trendPath = points.map((p, i) => `${i ? 'L' : 'M'}${g.x(p.date).toFixed(1)} ${g.y(g.tr[i]).toFixed(1)}`).join(' ');
  const h = hover != null ? points[hover] : null;

  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10"><circle cx="5" cy="5" r="3.5" fill="var(--cc-ink2)" /></svg>Weigh-ins
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="4"><line x1="1" y1="2" x2="17" y2="2" stroke="var(--cc-ink)" strokeWidth="2" strokeLinecap="round" /></svg>Trend
        </span>
        {goal && (
          <>
            <span className="flex items-center gap-1.5">
              <svg width="18" height="4"><line x1="1" y1="2" x2="17" y2="2" stroke="var(--cc-ink3)" strokeWidth="2" strokeDasharray="4 3" /></svg>On pace
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="18" height="4"><line x1="1" y1="2" x2="17" y2="2" stroke="var(--cc-accent)" strokeWidth="2" /></svg>Goal
            </span>
          </>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full touch-pan-y"
        role="img"
        aria-label={`Weight trend: ${points.length} weigh-ins${points.length ? `, latest ${kg(points[points.length - 1].kg)} kg` : ''}${goal ? `, goal ${kg(goal.targetKg)} kg by ${shortDate(goal.targetDate)}` : ''}.`}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {g.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={g.y(v)} y2={g.y(v)} stroke="var(--cc-separator)" strokeWidth="1" />
            <text x={pad.l - 6} y={g.y(v) + 4} textAnchor="end" fontSize="11" fill="var(--cc-ink2)" className="tnum">
              {v}
            </text>
          </g>
        ))}
        <text x={pad.l} y={H - 6} fontSize="11" fill="var(--cc-ink2)">
          {shortDate(g.from)}
        </text>
        <text x={W - pad.r} y={H - 6} fontSize="11" textAnchor="end" fill="var(--cc-ink2)">
          {shortDate(g.to)}
        </text>
        {goal && (
          <>
            <line x1={pad.l} x2={W - pad.r} y1={g.y(goal.targetKg)} y2={g.y(goal.targetKg)} stroke="var(--cc-accent)" strokeWidth="2" />
            <text x={pad.l + 4} y={g.y(goal.targetKg) - 5} textAnchor="start" fontSize="11" fontWeight="600" fill="var(--cc-accent)">
              Goal {kg(goal.targetKg).replace(/\.0$/, '')}
            </text>
            <line
              x1={g.x(goal.startDate)}
              y1={g.y(goal.startKg)}
              x2={g.x(goal.targetDate)}
              y2={g.y(goal.targetKg)}
              stroke="var(--cc-ink3)"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </>
        )}
        {points.length > 1 && <path d={trendPath} fill="none" stroke="var(--cc-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((p, i) => (
          <circle key={`${p.date}-${i}`} cx={g.x(p.date)} cy={g.y(p.kg)} r={hover === i ? 5 : 3.5} fill="var(--cc-ink2)" stroke="var(--cc-surface)" strokeWidth="2" />
        ))}
        {h && (
          <g pointerEvents="none">
            <line x1={g.x(h.date)} x2={g.x(h.date)} y1={pad.t} y2={H - pad.b} stroke="var(--cc-ink3)" strokeWidth="1" />
            <rect x={Math.min(Math.max(g.x(h.date) - 52, 0), W - 104)} y={0} width={104} height={20} rx={10} fill="var(--cc-ink)" />
            <text x={Math.min(Math.max(g.x(h.date), 52), W - 52)} y={14} textAnchor="middle" fontSize="11" fill="var(--cc-surface)" className="tnum">
              {shortDate(h.date)} · {kg(h.kg)} kg
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
