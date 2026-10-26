'use client';

// "What made up today's protein?" Tap a number on Today (a macro under the ring, a target bar, a
// nutrient in More nutrients) and this lists which of today's foods contributed how much, biggest
// first, with the foods that have no value for it. Switch nutrient at the top; tap a food to edit it.

import { targetState } from '@/design/components/TargetBar';
import { MEAL_LABEL } from '@/lib/dates';
import { breakdown, isAiEstimate, type DayView } from '@/lib/day';
import { amountText, energyIn, grams, int, nutrientText, unitLabel } from '@/lib/format';
import { NUTRIENT_BY_KEY, type NutrientKey } from '@/lib/nutrients';
import type { EnergyUnit, LogEntry } from '@/lib/types';
import { Chip, DashedChip, Sheet } from '../ui';

/** The nutrients the sheet can switch between, in Today's order. */
export const BREAKDOWN_KEYS: NutrientKey[] = ['energy_kj', 'protein_g', 'carbs_g', 'fat_g', 'sat_fat_g', 'sugars_g', 'fibre_g', 'sodium_mg', 'trans_fat_g'];

const CHIP_LABEL: Record<NutrientKey, string> = {
  energy_kj: 'Energy',
  protein_g: 'Protein',
  carbs_g: 'Carbs',
  fat_g: 'Fat',
  sat_fat_g: 'Sat fat',
  sugars_g: 'Sugars',
  fibre_g: 'Fibre',
  sodium_mg: 'Sodium',
  trans_fat_g: 'Trans fat',
};

export function BreakdownSheet({ day, unit, nutrient, onNutrient, onClose, onEntry }: {
  day: DayView;
  unit: EnergyUnit;
  nutrient: NutrientKey;
  onNutrient: (k: NutrientKey) => void;
  onClose: () => void;
  onEntry: (e: LogEntry) => void;
}) {
  const info = NUTRIENT_BY_KEY[nutrient];
  const entries = day.groups.flatMap((g) => g.entries);
  const { total, rows, missing } = breakdown(entries, nutrient);
  // The same rounding as Today's bars, so the two always show the same number.
  const fmt = (v: number) => (nutrient === 'energy_kj' ? nutrientText(nutrient, v, unit) : nutrient === 'sodium_mg' ? `${int(v)} mg` : `${grams(v)} g`);
  const colour = info.colour ? `var(--cc-${info.colour})` : 'var(--cc-ink2)';
  const name = CHIP_LABEL[nutrient].toLowerCase();

  // How the day stands against its target, as on Today.
  let against: string | null = null;
  if (nutrient === 'energy_kj' && day.ring) {
    against = `of ${int(day.ring.target)} ${unitLabel(unit)} today`;
  } else {
    const t = day.targetRows.find((r) => r.info.key === nutrient);
    if (t) {
      const u = nutrient === 'sodium_mg' ? 'mg' : 'g';
      const fmtN = nutrient === 'sodium_mg' ? int : grams;
      against = targetState({ value: total, direction: t.direction, min: t.min, max: t.max, unit: u, format: fmtN }).caption;
    }
  }

  return (
    <Sheet open onClose={onClose} label={`What made up today's ${name}`}>
      <div className="flex flex-col gap-3 pb-2">
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="mx-auto flex w-max gap-2" role="group" aria-label="Nutrient">
            {BREAKDOWN_KEYS.map((k) => (
              <Chip key={k} selected={k === nutrient} onClick={() => onNutrient(k)}>
                {CHIP_LABEL[k]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5 text-center">
          <span className="text-[30px] font-light leading-tight tracking-[-0.02em] tnum">{fmt(total)}</span>
          <span className="text-[13px] text-ink2 tnum">
            {against ?? `${CHIP_LABEL[nutrient]} today`}
            {missing.length > 0 && ` · at least: ${missing.length} ${missing.length === 1 ? 'food has' : 'foods have'} no value`}
          </span>
        </div>

        {rows.length === 0 ? (
          <p className="py-4 text-center text-[15px] text-ink2">{entries.length ? `None of today's foods add ${name}.` : 'Nothing logged yet today.'}</p>
        ) : (
          <div className="rounded-card bg-raised px-4 py-1">
            {rows.map(({ entry: e, value, share }) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onEntry(e)}
                className="flex min-h-[60px] w-full items-center gap-3 border-0 border-t border-separator bg-transparent py-2 text-left first:border-t-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[15px] leading-snug text-ink">{e.food_name_snapshot}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink2 tnum">
                    {MEAL_LABEL[e.meal]} · {amountText(e.entered_amount, e.entered_unit, e.entered_measure)}
                    {isAiEstimate(e) && <DashedChip>AI est.</DashedChip>}
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-sm bg-track" aria-hidden="true">
                    <span className="block h-full rounded-sm" style={{ width: `${Math.max(2, share * 100)}%`, background: colour }} />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-[15px] font-medium tnum">{nutrient === 'energy_kj' ? int(energyIn(value, unit)) : fmt(value)}</span>
                  <span className="text-[12px] text-ink2 tnum">{Math.round(share * 100)}%</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {missing.length > 0 && (
          <p className="mx-1 text-[13px] leading-snug text-ink2">
            No {name} value: {missing.map((e) => e.food_name_snapshot).join(', ')}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
