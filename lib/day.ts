// Everything the Today screen and the widget show for one local day, worked out from the log.
// Pure: no React, no Supabase.

import { goalFractions, splitEnergy, type ActivityKind, type MacroEnergy } from '@/design/components/ring';
import { addDays, dayBounds, MEAL_ORDER, type Meal } from './dates';
import { energyIn, kcalIn } from './format';
import { NUTRIENT_BY_ID, NUTRIENTS, scale, sumEntries, type NutrientInfo, type NutrientKey, type Totals } from './nutrients';
import { computeTarget, type BurnDay, type TargetBreakdown } from './target';
import { AI_ESTIMATE_TAG, type BurnRow, type EnergyUnit, type Goal, type LogEntry, type Profile, type TargetRow, type WeighIn } from './types';

/** One burn figure per day: the person's chosen app, else the one with the highest total. Never summed. */
export function pickBurn(rows: BurnRow[], date: string, preferred: string | null): BurnDay | null {
  const day = rows.filter((r) => r.date === date);
  if (!day.length) return null;
  const chosen =
    (preferred && day.find((r) => r.source_app === preferred)) ||
    [...day].sort((a, b) => (b.total_kcal ?? -1) - (a.total_kcal ?? -1))[0];
  return { date, total_kcal: chosen.total_kcal, active_kcal: chosen.active_kcal };
}

/** The latest weigh-in at or before the end of a local day. */
export function weightOn(weighIns: WeighIn[], date: string, tz: string): number | null {
  const end = dayBounds(tz, date).end.getTime();
  let best: WeighIn | null = null;
  for (const w of weighIns) {
    const t = new Date(w.measured_at).getTime();
    if (t < end && (!best || t > new Date(best.measured_at).getTime())) best = w;
  }
  return best ? best.weight_kg : null;
}

/**
 * Today's energy target, worked out one way for every screen (Today, the ring, the widget, the
 * target breakdown, the Goal preview and onboarding). Gathers the inputs: the latest weigh-in on or
 * before the day, that day's burn (one app, never summed), the 7 days before it for Stable mode,
 * and a typed target, then calls computeTarget. `goal` can be a draft, for previews.
 * Returns null until the profile has what the formula needs.
 */
export function targetFor(opts: {
  date: string;
  profile: Pick<Profile, 'birth_date' | 'sex' | 'height_cm' | 'activity_level' | 'time_zone' | 'burn_source' | 'stable_mode' | 'energy_target_override_kcal'>;
  weighIns: WeighIn[];
  burn: BurnRow[];
  goal: { targetKg: number; targetDate: string } | null;
  /** Weight to use when there's no weigh-in yet (the goal's start weight). */
  fallbackKg?: number | null;
  /** Replaces the profile's typed target (a draft on the Goal screen). */
  overrideKcal?: number | null;
}): TargetBreakdown | null {
  const { date, profile, burn } = opts;
  const currentKg = weightOn(opts.weighIns, date, profile.time_zone) ?? opts.fallbackKg ?? null;
  if (!profile.birth_date || !profile.sex || !profile.height_cm || !profile.activity_level || !currentKg) return null;
  const last7: BurnDay[] = [];
  for (let i = 1; i <= 7; i++) {
    const b = pickBurn(burn, addDays(date, -i), profile.burn_source);
    if (b) last7.push(b);
  }
  return computeTarget({
    today: date,
    birthDate: profile.birth_date,
    sex: profile.sex,
    heightCm: profile.height_cm,
    activityLevel: profile.activity_level,
    currentKg,
    goal: opts.goal,
    burnToday: pickBurn(burn, date, profile.burn_source),
    burnLast7: last7,
    stableMode: profile.stable_mode,
    overrideKcal: opts.overrideKcal !== undefined ? opts.overrideKcal : profile.energy_target_override_kcal,
  });
}

export interface TargetRowView {
  info: NutrientInfo;
  value: number | null;
  incomplete: number;
  /** Entries whose value here is an AI estimate. */
  ai: number;
  direction: 'atLeast' | 'noMoreThan' | 'range';
  min?: number;
  max: number;
}

export interface DayView {
  date: string;
  totals: Totals;
  /** Eaten energy split by macro, in the display unit. Adds up exactly to energy eaten. */
  eaten: MacroEnergy;
  eatenTotal: number;
  target: TargetBreakdown | null;
  /** Ring values in the display unit. */
  ring: { target: number; base: number; activity: ActivityKind; activityAmount: number } | null;
  goal: { progress: number; pace: number; paceKg: number; currentKg: number; targetKg: number; targetDate: string } | null;
  targetRows: TargetRowView[];
  /** Nutrients without a target, for the "more nutrients" card. Sodium first. */
  otherNutrients: { info: NutrientInfo; value: number | null; incomplete: number; ai: number }[];
  groups: { meal: Meal; entries: LogEntry[]; energyKj: number | null; incomplete: number; ai: number }[];
  /** Grams of each macro and its share of energy, for the ring's tap-to-switch centre. */
  macroGrams: { key: 'protein' | 'carbs' | 'fat'; grams: number | null; share: number }[];
}

const DIRECTION = { min: 'atLeast', max: 'noMoreThan', range: 'range' } as const;

export function targetRowView(t: TargetRow, totals: Totals, unit: EnergyUnit): TargetRowView | null {
  const info = NUTRIENT_BY_ID[t.nutrient];
  if (!info) return null;
  const raw = totals.values[info.key];
  const conv = (n: number) => (info.key === 'energy_kj' ? energyIn(n, unit) : n);
  // Energy targets are typed in the display unit; values are stored in kJ.
  const value = raw == null ? null : conv(raw);
  const max = t.direction === 'min' ? t.low : t.high;
  if (max == null) return null;
  return {
    info,
    value: totals.count === 0 ? 0 : value,
    incomplete: totals.missing[info.key],
    ai: totals.ai[info.key],
    direction: DIRECTION[t.direction],
    min: t.direction === 'range' ? (t.low ?? 0) : undefined,
    max,
  };
}

export function buildDay(opts: {
  date: string;
  entries: LogEntry[];
  profile: Profile;
  goal: Goal | null;
  weighIns: WeighIn[];
  burn: BurnRow[];
  targets: TargetRow[];
}): DayView {
  const { date, entries, profile, goal, weighIns, burn, targets } = opts;
  const unit = profile.energy_unit;
  const totals = sumEntries(entries.map(entryForTotals));
  const v = totals.values;
  const kj = v.energy_kj ?? 0;
  const split = splitEnergy(kj, { protein: v.protein_g, carbs: v.carbs_g, fat: v.fat_g });
  const eaten: MacroEnergy = {
    protein: energyIn(split.protein, unit),
    carbs: energyIn(split.carbs, unit),
    fat: energyIn(split.fat, unit),
    other: energyIn(split.other, unit),
  };
  const eatenTotal = energyIn(kj, unit);

  // Energy target for this day: the one function every screen uses.
  const currentKg = weightOn(weighIns, date, profile.time_zone) ?? goal?.start_weight_kg ?? null;
  const target = targetFor({
    date,
    profile,
    weighIns,
    burn,
    goal: goal ? { targetKg: goal.target_weight_kg, targetDate: goal.target_date } : null,
    fallbackKg: goal?.start_weight_kg,
  });
  const ring = target
    ? {
        target: kcalIn(target.rounded, unit),
        base: kcalIn(target.base, unit),
        activity: (target.own ? 'none' : target.activityKind === 'estimated' ? 'estimated' : 'measured') as ActivityKind,
        activityAmount: kcalIn(target.activity, unit),
      }
    : null;

  let goalView: DayView['goal'] = null;
  if (goal && currentKg) {
    const f = goalFractions({
      startKg: goal.start_weight_kg,
      currentKg,
      goalKg: goal.target_weight_kg,
      startDate: new Date(`${goal.start_date}T00:00:00Z`),
      goalDate: new Date(`${goal.target_date}T00:00:00Z`),
      today: new Date(`${date}T00:00:00Z`),
    });
    goalView = { ...f, currentKg, targetKg: goal.target_weight_kg, targetDate: goal.target_date };
  }

  const targetRows = targets
    .map((t) => targetRowView(t, totals, unit))
    .filter((r): r is TargetRowView => r != null)
    .sort((a, b) => NUTRIENTS.indexOf(a.info) - NUTRIENTS.indexOf(b.info));
  const targeted = new Set(targetRows.map((r) => r.info.key));
  const otherNutrients = NUTRIENTS.filter((n) => n.key !== 'energy_kj' && !targeted.has(n.key))
    .sort((a, b) => (a.key === 'sodium_mg' ? -1 : b.key === 'sodium_mg' ? 1 : 0))
    .map((info) => ({ info, value: totals.count === 0 ? 0 : totals.values[info.key], incomplete: totals.missing[info.key], ai: totals.ai[info.key] }));

  const groups = MEAL_ORDER.map((meal) => {
    const es = entries.filter((e) => e.meal === meal);
    const t = sumEntries(es.map(entryForTotals));
    return { meal, entries: es, energyKj: t.values.energy_kj, incomplete: t.missing.energy_kj, ai: t.ai.energy_kj };
  });

  const macroGrams = (['protein', 'carbs', 'fat'] as const).map((k) => {
    const g = k === 'protein' ? v.protein_g : k === 'carbs' ? v.carbs_g : v.fat_g;
    return { key: k, grams: g, share: kj > 0 ? split[k] / kj : 0 };
  });

  return { date, totals, eaten, eatenTotal, target, ring, goal: goalView, targetRows, otherNutrients, groups, macroGrams };
}

/** An entry's values are an AI estimate (Q5): it keeps that in source_snapshot. */
export const isAiEstimate = (e: Pick<LogEntry, 'source_snapshot'>) => e.source_snapshot === AI_ESTIMATE_TAG;

const entryForTotals = (e: LogEntry) => ({ per100: e.per100_snapshot, grams: e.grams, ai: isAiEstimate(e) });

/**
 * What made up a total on Today: each entry's share of one nutrient, biggest first, and the entries
 * with no value for it (so the total is "at least"). Tap a number on Today to see this.
 */
export function breakdown(entries: LogEntry[], key: NutrientKey): {
  total: number;
  rows: { entry: LogEntry; value: number; share: number }[];
  missing: LogEntry[];
} {
  const rows: { entry: LogEntry; value: number; share: number }[] = [];
  const missing: LogEntry[] = [];
  for (const e of entries) {
    const v = scale(e.per100_snapshot, e.grams)[key];
    if (v == null) missing.push(e);
    else if (v > 0) rows.push({ entry: e, value: v, share: 0 });
  }
  const total = rows.reduce((s, r) => s + r.value, 0);
  for (const r of rows) r.share = total > 0 ? r.value / total : 0;
  rows.sort((a, b) => b.value - a.value || a.entry.eaten_at.localeCompare(b.entry.eaten_at));
  return { total, rows, missing };
}

/** Energy for a single entry, in kJ (null if the food has no energy value). */
export const entryEnergyKj = (e: LogEntry) => scale(e.per100_snapshot, e.grams).energy_kj;
