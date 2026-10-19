'use client';

// Weight goal with its resulting daily target. Guardrails are advice, not walls: a warning can be
// continued past (and that choice is recorded); only the arithmetically impossible is refused.

import { localDate, shortDateYear } from '@/lib/dates';
import { int, kcalIn, unitLabel } from '@/lib/format';
import { checkGoal, KCAL_PER_KG, type GoalCheck, type Sex, type TargetBreakdown, type WarningKey } from '@/lib/target';
import type { EnergyUnit } from '@/lib/types';
import { Button, Card, Field, Switch } from '../ui';

export interface GoalValues {
  target_kg: string;
  target_date: string;
  own_target: boolean;
  own_target_value: string; // in the display unit
}

type DraftGoal = { targetKg: number; targetDate: string };

export interface GoalContext {
  sex: Sex;
  currentKg: number;
  today: string;
  ratePct: number;
  floorKcal: number | null;
  unit: EnergyUnit;
  /** Today's target for a draft goal: the same function as Today and the ring (lib/day.ts targetFor). */
  targetFor: (goal: DraftGoal, overrideKcal: number | null) => TargetBreakdown | null;
  /**
   * A whole-day figure for the guardrails: the 7-day average or the activity-level estimate, never a
   * part-day measured burn, so an early-morning target can't trip the "too low" warning.
   */
  wholeDayFor: (goal: DraftGoal, overrideKcal: number | null) => TargetBreakdown | null;
}

export interface GoalEvaluation {
  ready: boolean;
  check: GoalCheck | null;
  breakdown: TargetBreakdown | null;
  overrideKcal: number | null;
}

export function evaluateGoal(v: GoalValues, ctx: GoalContext, dismissed: WarningKey[]): GoalEvaluation {
  const targetKg = Number(v.target_kg.replace(',', '.'));
  const overrideKcal = v.own_target && Number(v.own_target_value) > 0 ? (ctx.unit === 'kj' ? Number(v.own_target_value) / 4.184 : Number(v.own_target_value)) : null;
  if (!(targetKg > 25) || !/^\d{4}-\d{2}-\d{2}$/.test(v.target_date)) return { ready: false, check: null, breakdown: null, overrideKcal };
  const goal = { targetKg, targetDate: v.target_date };
  const breakdown = ctx.targetFor(goal, overrideKcal);
  const wholeDay = ctx.wholeDayFor(goal, overrideKcal);
  if (!breakdown || !wholeDay) return { ready: false, check: null, breakdown, overrideKcal };
  const check = checkGoal({
    today: ctx.today,
    currentKg: ctx.currentKg,
    targetKg,
    targetDate: v.target_date,
    sex: ctx.sex,
    maintenanceKcal: wholeDay.maintenance,
    targetKcal: wholeDay.rounded,
    ratePctPerWeek: ctx.ratePct,
    floorKcal: ctx.floorKcal,
    dismissed,
    overrideKcal,
  });
  return { ready: !check.refusal && check.warnings.length === 0, check, breakdown, overrideKcal };
}

/** "−367 kcal a day · about 0.33 kg a week": the part of the target the goal controls. */
export function goalLine(t: TargetBreakdown, unit: EnergyUnit): string {
  const perDay = int(kcalIn(Math.abs(t.adjustment), unit));
  const perWeek = ((Math.abs(t.adjustment) * 7) / KCAL_PER_KG).toFixed(2);
  if (Math.round(t.adjustment) === 0) return 'No change: you are at your goal weight';
  return `${t.adjustment < 0 ? '−' : '+'}${perDay} ${unitLabel(unit)} a day · about ${perWeek} kg a week`;
}

/** "Today's target 1,660 so far", from the same function as Today. */
export function todaysTargetLine(t: TargetBreakdown, unit: EnergyUnit): string {
  const n = int(kcalIn(t.rounded, unit));
  if (t.activityKind === 'measured') return `Today's target ${n} so far`;
  if (t.activityKind === 'stable') return `Today's target ${n}, from your 7-day average burn`;
  return `Today's target ${n}, with activity estimated`;
}

export function GoalForm({ value, onChange, ctx, evaluation, onContinueAnyway }: {
  value: GoalValues;
  onChange: (v: GoalValues) => void;
  ctx: GoalContext;
  evaluation: GoalEvaluation;
  onContinueAnyway: (key: WarningKey) => void;
}) {
  const set = <K extends keyof GoalValues>(k: K, v: GoalValues[K]) => onChange({ ...value, [k]: v });
  const b = evaluation.breakdown;
  const unit = ctx.unit;
  const u = unitLabel(unit);
  const warning = evaluation.check?.warnings[0];
  const refusal = evaluation.check?.refusal;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4">
        <Field
          id="goal-weight"
          label="Goal weight"
          unit="kg"
          inputMode="decimal"
          value={value.target_kg}
          onChange={(e) => set('target_kg', e.target.value.replace(/[^\d.,]/g, ''))}
          hint={`You're ${ctx.currentKg.toFixed(1)} kg now.`}
        />
        <Field label="By" type="date" min={localDate('UTC')} value={value.target_date} onChange={(e) => set('target_date', e.target.value)} />
      </Card>

      {b && !refusal && (
        <Card>
          {b.own ? (
            <p className="text-[21px] font-medium tnum">
              {int(kcalIn(b.rounded, unit))} {u} a day <span className="text-sm font-normal text-ink2">· your own number</span>
            </p>
          ) : (
            <>
              <p className="text-[21px] font-medium leading-snug tnum">{goalLine(b, unit)}</p>
              <p className="mt-1 text-[14px] text-ink2 tnum">{todaysTargetLine(b, unit)}</p>
            </>
          )}
        </Card>
      )}

      {refusal && (
        <Card>
          <p className="text-[17px] font-semibold text-warn-text">This goal isn&apos;t possible as set</p>
          <p className="mt-1 text-[15px] leading-snug text-ink2">{refusal.message}</p>
          <div className="mt-3 flex gap-2">
            <Button size="md" variant="secondary" onClick={() => set('target_date', refusal.earliestDate)}>
              Use {shortDateYear(refusal.earliestDate)}
            </Button>
          </div>
        </Card>
      )}

      {warning && !refusal && (
        <Card>
          <p className="text-[17px] font-semibold text-warn-text">{warning.headline}</p>
          <p className="mt-1 text-[15px] leading-snug text-ink2">{warning.body}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button size="md" variant="secondary" onClick={() => onContinueAnyway(warning.key)}>
              Continue anyway
            </Button>
            <Button size="md" onClick={() => document.getElementById('goal-weight')?.focus()}>
              Change goal
            </Button>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-base">Use my own daily target</span>
            <span className="block text-[13px] text-ink2">Type any number instead of the calculation. No warnings.</span>
          </span>
          <Switch label="Use my own daily target" checked={value.own_target} onChange={(v) => set('own_target', v)} />
        </div>
        {value.own_target && (
          <Field
            label="Daily target"
            unit={u}
            inputMode="numeric"
            value={value.own_target_value}
            onChange={(e) => set('own_target_value', e.target.value.replace(/\D/g, ''))}
          />
        )}
      </Card>
    </div>
  );
}
