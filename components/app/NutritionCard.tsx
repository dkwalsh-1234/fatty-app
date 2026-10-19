// Per-100 g (and optionally per-serve) nutrition card, as on the meal editor and food detail.
// Missing values show "–", never 0.

import { energyText, nutrientText, saltText } from '@/lib/format';
import { NUTRIENTS, scale, type Per100 } from '@/lib/nutrients';
import type { EnergyUnit } from '@/lib/types';
import { cx, MacroDot } from '../ui';

export function NutritionCard({ per100, serveGrams, unit, title = 'Nutrition', liquid }: {
  per100: Per100;
  serveGrams?: number | null;
  unit: EnergyUnit;
  title?: string;
  liquid?: boolean;
}) {
  const serve = serveGrams ? scale(per100, serveGrams) : null;
  const cols = serve ? 'grid-cols-[minmax(0,1fr)_92px_80px]' : 'grid-cols-[minmax(0,1fr)_100px]';
  return (
    <section aria-label={title} className="rounded-card bg-surface px-5 pb-2 pt-1.5 shadow-[var(--cc-card-shadow)]">
      <div className={cx('grid h-11 items-center gap-x-2', cols)}>
        <span className="text-[17px] font-semibold">{title}</span>
        {serve && <span className="text-right text-xs text-ink2">per serve</span>}
        <span className="text-right text-xs text-ink2">per 100 {liquid ? 'mL' : 'g'}</span>
      </div>
      {NUTRIENTS.map((n) => {
        const v100 = per100[n.key];
        const text = (v: number | null) => (n.key === 'energy_kj' ? energyText(v, unit) : nutrientText(n.key, v, unit));
        return (
          <div key={n.key} className={cx('grid min-h-[34px] items-center gap-x-2 border-t border-separator', cols)}>
            <span className={cx('flex items-center gap-2 text-[15px]', n.child ? 'pl-[15px] text-ink2' : 'text-ink')}>
              {!n.child && n.colour && <MacroDot colour={n.colour} size={7} />}
              {n.child ? n.label.replace(/ fat$/, '') : n.label === 'Dietary fibre' ? 'Fibre' : n.label}
            </span>
            {serve && <span className="text-right text-[15px] font-medium tnum">{text(serve[n.key])}</span>}
            <span className={cx('text-right text-[15px] tnum', serve ? 'text-ink2' : 'font-medium')}>
              {text(v100)}
              {n.key === 'sodium_mg' && v100 != null && !serve && <span className="block text-[11px] text-ink2">({saltText(v100)})</span>}
            </span>
          </div>
        );
      })}
    </section>
  );
}
