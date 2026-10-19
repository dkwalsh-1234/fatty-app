// "How today's target is worked out": the parts of the one target (lib/target.ts), as shown on the
// Goal screen and in the sheet behind the caption under Today's ring.

import { int, kcalIn, kg, unitLabel } from '@/lib/format';
import { ACTIVITY_FACTORS, ACTIVITY_LABELS, KCAL_PER_KG, type ActivityLevel, type TargetBreakdown } from '@/lib/target';
import type { EnergyUnit } from '@/lib/types';
import { Card } from '../ui';

export function TargetBreakdownCard({ t, unit, activityLevel, kgToGo }: {
  t: TargetBreakdown;
  unit: EnergyUnit;
  activityLevel: ActivityLevel | null;
  /** Goal weight − current weight, for the adjustment line. Null when there's no goal. */
  kgToGo: number | null;
}) {
  const u = unitLabel(unit);
  const n = (kcal: number) => int(kcalIn(kcal, unit));
  if (t.own) {
    return (
      <Card className="py-2">
        <Line label="Your own target" sub="Typed in on the Goal screen or in Settings, so nothing is worked out" value={`${n(t.rounded)} ${u}`} strong />
      </Card>
    );
  }
  const level = activityLevel ?? 'sitting';
  const activitySub =
    t.activityKind === 'measured'
      ? 'Measured today through Health Connect, so far'
      : t.activityKind === 'stable'
        ? 'Stable mode: your 7-day average burn'
        : `Estimated: ${ACTIVITY_LABELS[level].toLowerCase()} (resting × ${ACTIVITY_FACTORS[level]}), until Health Connect has burn for today`;
  return (
    <Card className="flex flex-col gap-0 py-2">
      <Line label="Resting energy" sub="Mifflin-St Jeor, from your age, sex, height and latest weight" value={`${n(t.resting)} ${u}`} />
      <Line label="Activity" sub={activitySub} value={`+${n(t.activity)} ${u}`} />
      <Line
        label="Goal adjustment"
        sub={t.daysLeft != null && t.daysLeft > 0 && kgToGo != null ? `${kg(Math.abs(kgToGo))} kg × ${KCAL_PER_KG.toLocaleString('en-AU')} kcal ÷ ${t.daysLeft} days left` : 'No goal'}
        value={`${t.adjustment < 0 ? '−' : '+'}${n(Math.abs(t.adjustment))} ${u}`}
      />
      <Line label="Today's target" sub="Rounded to the nearest 10" value={`${n(t.rounded)} ${u}`} strong />
    </Card>
  );
}

export const PRECISION_NOTE =
  'Watch estimates of calories burned are often 20 to 30% out, the formula is a population average, and 7,700 kcal per kg is a rule of thumb that overstates loss over longer periods. Judge progress by your weight trend.';

function Line({ label, sub, value, strong }: { label: string; sub: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-separator py-2 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className={strong ? 'block text-base font-semibold' : 'block text-base'}>{label}</span>
        <span className="block text-[13px] leading-snug text-ink2">{sub}</span>
      </span>
      <span className={strong ? 'text-[19px] font-medium tnum' : 'text-[15px] tnum'}>{value}</span>
    </div>
  );
}
