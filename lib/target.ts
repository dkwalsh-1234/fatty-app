// Daily energy target, as in the brief's "Daily energy target" section. All energy here is kcal.
// Guardrails are advice, not walls: warnings can be dismissed; only the arithmetically impossible is refused.

import { addDays, ageOn, daysBetween } from './dates';

export type Sex = 'female' | 'male';
export type ActivityLevel = 'sitting' | 'some' | 'active' | 'very_active';

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sitting: 0.2,
  some: 0.375,
  active: 0.55,
  very_active: 0.725,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sitting: 'Mostly sitting',
  some: 'On your feet some of the day',
  active: 'Active job or daily exercise',
  very_active: 'Very active',
};

export const KCAL_PER_KG = 7700;
/** Earliest-date suggestion when a goal is refused. */
export const SAFE_DEFICIT_KCAL = 1000;
export const DEFAULT_FLOOR_KCAL: Record<Sex, number> = { female: 1200, male: 1500 };

export const roundTarget = (kcal: number) => Math.round(kcal / 10) * 10;

/** Mifflin-St Jeor resting energy, kcal/day. */
export function restingKcal(p: { weightKg: number; heightCm: number; age: number; sex: Sex }): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}

export interface BurnDay {
  date: string;
  total_kcal: number | null;
  active_kcal: number | null;
}

export type ActivitySource = 'measured' | 'estimated' | 'stable' | 'override';

export interface TargetInput {
  today: string;
  birthDate: string;
  sex: Sex;
  heightCm: number;
  activityLevel: ActivityLevel;
  /** Latest weigh-in drives the target. */
  currentKg: number;
  goal: { targetKg: number; targetDate: string } | null;
  /** Today's burn from Health Connect, if any. */
  burnToday?: BurnDay | null;
  /** The last 7 days of burn, for Stable mode. */
  burnLast7?: BurnDay[];
  stableMode?: boolean;
  overrideKcal?: number | null;
}

export interface TargetBreakdown {
  /** Rounded to the nearest 10 kcal. */
  target: number;
  resting: number;
  activity: number;
  activitySource: ActivitySource;
  adjustment: number;
  /** The part of the target that isn't activity: resting + adjustment (the ring's base track). */
  base: number;
  daysLeft: number | null;
  /** Resting + activity, before the goal adjustment. */
  maintenance: number;
}

function activityFromBurn(burn: BurnDay, resting: number): number | null {
  if (burn.active_kcal != null) return Math.max(0, burn.active_kcal);
  if (burn.total_kcal != null) return Math.max(0, burn.total_kcal - resting);
  return null;
}

export function dailyAdjustment(currentKg: number, goal: TargetInput['goal'], today: string) {
  if (!goal) return { adjustment: 0, daysLeft: null as number | null };
  const daysLeft = daysBetween(today, goal.targetDate);
  if (daysLeft <= 0) return { adjustment: 0, daysLeft };
  return { adjustment: ((goal.targetKg - currentKg) * KCAL_PER_KG) / daysLeft, daysLeft };
}

export function computeTarget(input: TargetInput): TargetBreakdown {
  const age = ageOn(input.birthDate, input.today);
  const resting = restingKcal({ weightKg: input.currentKg, heightCm: input.heightCm, age, sex: input.sex });
  const { adjustment, daysLeft } = dailyAdjustment(input.currentKg, input.goal, input.today);

  if (input.overrideKcal != null && input.overrideKcal > 0) {
    const t = roundTarget(input.overrideKcal);
    return { target: t, resting, activity: 0, activitySource: 'override', adjustment: 0, base: t, daysLeft, maintenance: resting };
  }

  let activity: number;
  let activitySource: ActivitySource;
  const week = (input.burnLast7 ?? []).filter((b) => b.total_kcal != null);
  const measuredToday = input.burnToday ? activityFromBurn(input.burnToday, resting) : null;

  if (input.stableMode && week.length > 0) {
    // Stable mode: the 7-day average of total burn is the whole-day figure.
    const avgTotal = week.reduce((s, b) => s + (b.total_kcal as number), 0) / week.length;
    activity = Math.max(0, avgTotal - resting);
    activitySource = 'stable';
  } else if (measuredToday != null) {
    activity = measuredToday;
    activitySource = 'measured';
  } else {
    activity = resting * ACTIVITY_FACTORS[input.activityLevel];
    activitySource = 'estimated';
  }

  const raw = resting + activity + adjustment;
  const target = roundTarget(raw);
  return {
    target,
    resting,
    activity,
    activitySource,
    adjustment,
    base: Math.max(0, target - activity),
    daysLeft,
    maintenance: resting + activity,
  };
}

// Guardrails ----------------------------------------------------------------------------------

export type WarningKey = 'rate' | 'floor';

export interface GoalWarning {
  key: WarningKey;
  headline: string;
  body: string;
}

export interface GoalRefusal {
  reason: 'date_passed' | 'impossible';
  message: string;
  /** Earliest date the goal is reachable at a 1,000 kcal daily deficit (losing) or equivalent surplus (gaining). */
  earliestDate: string;
}

export interface GoalCheck {
  refusal: GoalRefusal | null;
  warnings: GoalWarning[];
}

export function earliestReachableDate(currentKg: number, targetKg: number, today: string): string {
  const days = Math.ceil((Math.abs(targetKg - currentKg) * KCAL_PER_KG) / SAFE_DEFICIT_KCAL);
  return addDays(today, Math.max(1, days));
}

/** The date at the warning rate (default 1% of body weight a week). */
export function dateAtRate(currentKg: number, targetKg: number, today: string, ratePctPerWeek: number): string {
  const perWeek = (currentKg * ratePctPerWeek) / 100;
  const weeks = perWeek > 0 ? Math.abs(targetKg - currentKg) / perWeek : 0;
  return addDays(today, Math.max(1, Math.ceil(weeks * 7)));
}

export interface GoalCheckInput {
  today: string;
  currentKg: number;
  targetKg: number;
  targetDate: string;
  sex: Sex;
  /** Resting + activity used for the check (estimated activity during onboarding). */
  maintenanceKcal: number;
  /** The daily target this goal produces. */
  targetKcal: number;
  ratePctPerWeek?: number;
  floorKcal?: number | null;
  /** Warnings already continued past for this goal. */
  dismissed?: WarningKey[];
  /** A typed energy target replaces the calculation and skips every warning. */
  overrideKcal?: number | null;
}

/** Formats a date for messages without pulling in the display helpers. */
const fmt = (d: string) =>
  new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${d}T12:00:00Z`),
  );

export function checkGoal(i: GoalCheckInput): GoalCheck {
  const daysLeft = daysBetween(i.today, i.targetDate);
  const losing = i.targetKg < i.currentKg;
  if (daysLeft <= 0) {
    const earliestDate = earliestReachableDate(i.currentKg, i.targetKg, i.today);
    return {
      refusal: {
        reason: 'date_passed',
        message: `That date has already passed. The earliest date this goal is reachable at a ${SAFE_DEFICIT_KCAL.toLocaleString('en-AU')} kcal daily deficit is ${fmt(earliestDate)}. Choose a new date or weight.`,
        earliestDate,
      },
      warnings: [],
    };
  }
  const dailyChange = ((i.targetKg - i.currentKg) * KCAL_PER_KG) / daysLeft;
  if (losing && -dailyChange > i.maintenanceKcal) {
    const earliestDate = earliestReachableDate(i.currentKg, i.targetKg, i.today);
    return {
      refusal: {
        reason: 'impossible',
        message: `This goal would need a daily target below zero. The earliest date it's reachable at a ${SAFE_DEFICIT_KCAL.toLocaleString('en-AU')} kcal daily deficit is ${fmt(earliestDate)}. Choose a new date or weight.`,
        earliestDate,
      },
      warnings: [],
    };
  }
  if (i.overrideKcal != null && i.overrideKcal > 0) return { refusal: null, warnings: [] };

  const dismissed = new Set(i.dismissed ?? []);
  const warnings: GoalWarning[] = [];
  const rate = i.ratePctPerWeek ?? 1;
  const kgPerWeek = (Math.abs(i.targetKg - i.currentKg) / daysLeft) * 7;
  if (!dismissed.has('rate') && kgPerWeek > (i.currentKg * rate) / 100) {
    const d = dateAtRate(i.currentKg, i.targetKg, i.today, rate);
    warnings.push({
      key: 'rate',
      headline: 'Faster than most people can sustain',
      body: `At ${rate}% a week you'd get there by ${fmt(d)}.`,
    });
  }
  const floor = i.floorKcal ?? DEFAULT_FLOOR_KCAL[i.sex];
  if (!dismissed.has('floor') && i.targetKcal < floor) {
    warnings.push({
      key: 'floor',
      headline: 'Below the level usually advised without medical supervision',
      body: `This goal gives a daily target of ${roundTarget(i.targetKcal).toLocaleString('en-AU')} kcal, under ${floor.toLocaleString('en-AU')} kcal.`,
    });
  }
  return { refusal: null, warnings };
}

// Nutrient targets -----------------------------------------------------------------------------

export type Direction = 'min' | 'max' | 'range';

export interface NutrientTarget {
  nutrient: string; // NutrientInfo.id
  direction: Direction;
  low: number | null;
  high: number | null;
}

/** One-line warning when nutrient minimums alone exceed the energy target. Never blocks. */
export function targetsConflict(targets: NutrientTarget[], energyKcal: number): string | null {
  const factorsKj: Record<string, number> = { protein: 17, carbs: 17, fat: 37 };
  let kj = 0;
  for (const t of targets) {
    const f = factorsKj[t.nutrient];
    if (!f) continue;
    const min = t.direction === 'max' ? null : t.low;
    if (min != null) kj += min * f;
  }
  const kcal = kj / 4.184;
  if (kcal > energyKcal) {
    return `Your minimums for protein, carbohydrate and fat add up to about ${roundTarget(kcal).toLocaleString('en-AU')} kcal, more than today's target of ${energyKcal.toLocaleString('en-AU')}.`;
  }
  return null;
}
