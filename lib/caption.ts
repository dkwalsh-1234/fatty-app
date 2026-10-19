// The line under Today's ring: the parts of the target, which add up to the number in the centre
// (before rounding to 10). "1,738 resting − 367 goal + 285 active so far".

import { int, kcalIn } from './format';
import type { TargetBreakdown } from './target';
import type { EnergyUnit } from './types';

export type CaptionParts =
  | { own: true; text: string }
  | {
      own: false;
      resting: string;
      /** Null when there's no goal adjustment (no goal, or it rounds to 0). */
      goal: { sign: '−' | '+'; value: string } | null;
      active: string;
      /** " so far", ", est." or ", 7-day avg". */
      suffix: string;
      kind: TargetBreakdown['activityKind'];
      /** The whole line as plain text, for screen readers and tests. */
      text: string;
    };

export function captionParts(t: TargetBreakdown, unit: EnergyUnit): CaptionParts {
  if (t.own) return { own: true, text: 'Your own target' };
  const n = (kcal: number) => int(kcalIn(kcal, unit));
  const goalValue = Math.round(kcalIn(Math.abs(t.adjustment), unit));
  const goal = goalValue === 0 ? null : { sign: (t.adjustment < 0 ? '−' : '+') as '−' | '+', value: n(Math.abs(t.adjustment)) };
  const suffix = t.activityKind === 'measured' ? ' so far' : t.activityKind === 'stable' ? ', 7-day avg' : ', est.';
  const resting = n(t.resting);
  const active = n(t.activity);
  const text = `${resting} resting${goal ? ` ${goal.sign} ${goal.value} goal` : ''} + ${active} active${suffix}`;
  return { own: false, resting, goal, active, suffix, kind: t.activityKind, text };
}
