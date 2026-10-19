// Energy ring maths and geometry. Pure functions, no React, no DOM.
// Shared by EnergyRing.tsx (web) and mirrored in android/RingBitmap.kt (widget).

export const KJ_PER_KCAL = 4.184;

/** Food Standards Code energy factors, kJ per gram. */
export const ENERGY_FACTORS_KJ = { protein: 17, carbs: 17, fat: 37 } as const;

export interface MacroEnergy {
  protein: number;
  carbs: number;
  fat: number;
  /** Fibre, alcohol, label rounding: whatever the three macros don't explain. */
  other: number;
}

/**
 * Split logged energy into macro segments (brief, "Segment maths").
 * Works in kJ. If the macros explain less than the logged energy, the gap is "other".
 * If they explain more (label rounding), scale them down so they match exactly.
 * A null macro (missing, not zero) contributes nothing, so its energy lands in "other".
 * The four parts always add up exactly to energyKj.
 */
export function splitEnergy(
  energyKj: number,
  grams: { protein: number | null; carbs: number | null; fat: number | null },
): MacroEnergy {
  const p = (grams.protein ?? 0) * ENERGY_FACTORS_KJ.protein;
  const c = (grams.carbs ?? 0) * ENERGY_FACTORS_KJ.carbs;
  const f = (grams.fat ?? 0) * ENERGY_FACTORS_KJ.fat;
  const sum = p + c + f;
  if (energyKj <= 0) return { protein: 0, carbs: 0, fat: 0, other: 0 };
  if (sum <= energyKj) return { protein: p, carbs: c, fat: f, other: energyKj - sum };
  const k = energyKj / sum;
  return { protein: p * k, carbs: c * k, fat: f * k, other: 0 };
}

export type ActivityKind = 'measured' | 'estimated' | 'none';

export interface RingInput {
  /** Outer box size in px (Today 280, widget 136). */
  size: number;
  /** Segment stroke width in px (Today 26, widget 15). */
  stroke: number;
  /** Activity rail width in px (Today 5, widget 3). */
  rail: number;
  /** Gap between the ring and the edge of the box, px. Leaves room for the shadow. */
  inset?: number;
  /** Today's energy target, any unit (use the same unit for every value). */
  target: number;
  /** The part of the target that does not come from activity: resting + goal adjustment. */
  base: number;
  /** Eaten energy split by macro, same unit as target. */
  eaten: MacroEnergy;
  activity: ActivityKind;
  /** Optional goal mini-map inside the ring. Fractions 0..1 of the way from start to goal weight. */
  goal?: { progress: number; pace: number } | null;
}

export interface RingSegment {
  key: keyof MacroEnergy;
  d: string;
}

export interface RingGeometry {
  size: number;
  cx: number;
  r: number;
  stroke: number;
  /** Activity rail from the base boundary to 12 o'clock, or null. */
  activity: { d: string; dashed: boolean; width: number; dash: string } | null;
  /** Draw in this order: other, fat, carbs, protein. Each is cumulative from 12 o'clock. */
  segments: RingSegment[];
  /** Second lap for energy over target, drawn last, or null. */
  lap: string | null;
  /** Goal mini-map (halo) inside the ring, or null. */
  halo: {
    r: number;
    progress: string | null;
    now: { x: number; y: number };
    pace: { x: number; y: number };
  } | null;
  eatenTotal: number;
  /** Positive = left to eat, negative = over. */
  remaining: number;
  over: boolean;
}

const TAU = Math.PI * 2;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const fixed = (n: number) => Math.round(n * 100) / 100;

/** Point on a circle, f = 0 at 12 o'clock, clockwise. */
export function polar(cx: number, r: number, f: number): { x: number; y: number } {
  const a = f * TAU - Math.PI / 2;
  return { x: fixed(cx + r * Math.cos(a)), y: fixed(cx + r * Math.sin(a)) };
}

/** SVG arc path from fraction f0 to f1, clockwise. A full turn is drawn as 0.9995 of a turn. */
export function arcPath(cx: number, r: number, f0: number, f1: number): string | null {
  if (f1 - f0 > 0.9995) f1 = f0 + 0.9995;
  if (f1 <= f0) return null;
  const a = polar(cx, r, f0);
  const b = polar(cx, r, f1);
  const large = f1 - f0 > 0.5 ? 1 : 0;
  return `M${a.x} ${a.y} A${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

/**
 * Builds every path for the ring.
 * Round caps would overshoot the true value by half a stroke at each end, so each arc is
 * pulled in by k = (stroke / 2) / circumference. The visible ends then land exactly on the value.
 */
export function ringGeometry(input: RingInput): RingGeometry {
  const { size, stroke, rail, target, base, eaten, activity } = input;
  const inset = input.inset ?? 3;
  const cx = size / 2;
  const r = size / 2 - stroke / 2 - inset;
  const circ = TAU * r;
  const k = stroke / 2 / circ;
  const kRail = rail / 2 / circ;
  const safeTarget = target > 0 ? target : 1;

  const order: (keyof MacroEnergy)[] = ['protein', 'carbs', 'fat', 'other'];
  const eatenTotal = order.reduce((s, m) => s + Math.max(0, eaten[m]), 0);

  // Cumulative ends on the first lap.
  let acc = 0;
  const cum: Record<keyof MacroEnergy, number> = { protein: 0, carbs: 0, fat: 0, other: 0 };
  for (const m of order) {
    acc += Math.max(0, eaten[m]);
    cum[m] = Math.min(acc / safeTarget, 1);
  }
  const seg = (f: number) => (f <= 0 ? null : arcPath(cx, r, k, Math.max(f - k, k + 0.0001)));
  const segments: RingSegment[] = [];
  for (const m of ['other', 'fat', 'carbs', 'protein'] as const) {
    const d = seg(cum[m]);
    if (d) segments.push({ key: m, d });
  }

  // Activity rail: from the base boundary to 12 o'clock. Covered by segments as food is logged.
  const fb = clamp01(base / safeTarget);
  const railPath = activity !== 'none' && fb < 1 ? arcPath(cx, r, fb + kRail, 1 - kRail) : null;

  // Over target: a second lap from 12 o'clock in the warning tone.
  const overBy = Math.max(eatenTotal - target, 0) / safeTarget;
  const lap = overBy > 0 ? arcPath(cx, r, k, Math.max(overBy - k, k + 0.0001)) : null;

  let halo: RingGeometry['halo'] = null;
  if (input.goal) {
    const hr = r - stroke / 2 - 16;
    const p = clamp01(input.goal.progress);
    halo = {
      r: hr,
      progress: p > 0 ? arcPath(cx, hr, 0, p) : null,
      now: polar(cx, hr, p),
      pace: polar(cx, hr, clamp01(input.goal.pace)),
    };
  }

  return {
    size,
    cx,
    r,
    stroke,
    activity: railPath
      ? { d: railPath, dashed: activity === 'estimated', width: rail, dash: activity === 'estimated' ? `0 ${fixed(rail * 2.2)}` : 'none' }
      : null,
    segments,
    lap,
    halo,
    eatenTotal,
    remaining: target - eatenTotal,
    over: eatenTotal > target,
  };
}

/**
 * Goal mini-map fractions from weights. Works for losing or gaining.
 * progress = how far from start to goal you are; pace = where you'd be today on a straight line.
 */
export function goalFractions(opts: {
  startKg: number;
  currentKg: number;
  goalKg: number;
  startDate: Date;
  goalDate: Date;
  today: Date;
}): { progress: number; pace: number; paceKg: number } {
  const span = opts.goalKg - opts.startKg;
  const days = (opts.goalDate.getTime() - opts.startDate.getTime()) / 86_400_000;
  const elapsed = (opts.today.getTime() - opts.startDate.getTime()) / 86_400_000;
  const t = days > 0 ? clamp01(elapsed / days) : 1;
  const progress = span === 0 ? 1 : clamp01((opts.currentKg - opts.startKg) / span);
  return { progress, pace: t, paceKg: Math.round((opts.startKg + span * t) * 10) / 10 };
}
