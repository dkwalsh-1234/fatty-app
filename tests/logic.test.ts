// Pure logic against the brief's acceptance checks.
import { describe, expect, it } from 'vitest';
import { ringGeometry, splitEnergy } from '@/design/components/ring';
import { targetState } from '@/design/components/TargetBar';
import { buildChips, cleanTyped, convertAmount, countText, countUnit, mealPer100, measureChipLabel, naturalStart, parseTyped, stepCount, unitOptions } from '@/lib/amount';
import { barcodeVariants, hasValidCheckDigit, normalizeBarcode, upcEToUpcA } from '@/lib/barcode';
import { addDays, ageOn, dayBounds, localDate, mealForTime, zonedToUtc } from '@/lib/dates';
import { evaluateGoal, goalLine, todaysTargetLine } from '@/components/forms/GoalForm';
import { captionParts } from '@/lib/caption';
import { breakdown, buildDay, pickBurn, targetFor } from '@/lib/day';
import { amountText, nutrientText, saltText } from '@/lib/format';
import { emptyPer100, scale, sumEntries, toPer100, type Per100 } from '@/lib/nutrients';
import { parseSearch, parseText } from '@/lib/parse';
import { cleanEstimate, cleanResolve, componentsForGrams, isWeakMatch } from '@/lib/resolution';
import { mapOffProduct } from '@/lib/sources/off';
import { mapOffAuRow } from '@/lib/sources/off-au';
import { afcdDuplicates } from '@/lib/sources/fsanz-dedupe';
import { checkGoal, computeTarget, restingKcal, roundTarget, targetsConflict } from '@/lib/target';
import type { BurnRow, Food, FoodStats, Goal, LogEntry, Profile } from '@/lib/types';
import { widgetSummary } from '@/lib/widget';

const p100 = (o: Partial<Per100>): Per100 => ({ ...emptyPer100(), ...o });

describe('day totals', () => {
  it('match a manual calculation exactly (1 kJ, 0.1 g, 1 mg)', () => {
    const oats = p100({ energy_kj: 1580, protein_g: 12.1, fat_g: 8.4, sat_fat_g: 1.5, trans_fat_g: 0, carbs_g: 56.3, sugars_g: 1.2, fibre_g: 10.2, sodium_mg: 6 });
    const milk = p100({ energy_kj: 274, protein_g: 3.4, fat_g: 3.6, sat_fat_g: 2.3, trans_fat_g: 0.1, carbs_g: 4.8, sugars_g: 4.8, fibre_g: 0, sodium_mg: 41 });
    const banana = p100({ energy_kj: 380, protein_g: 1.4, fat_g: 0.3, sat_fat_g: 0.1, trans_fat_g: 0, carbs_g: 20.1, sugars_g: 17.9, fibre_g: 2.4, sodium_mg: 1 });
    const t = sumEntries([
      { per100: oats, grams: 45 },
      { per100: milk, grams: 250 },
      { per100: banana, grams: 120 },
    ]);
    // By hand: 45 g oats = 711 kJ; 250 g milk = 685 kJ; 120 g banana = 456 kJ.
    expect(Math.round(t.values.energy_kj!)).toBe(711 + 685 + 456);
    expect(Math.round(t.values.protein_g! * 10) / 10).toBe(Math.round((5.445 + 8.5 + 1.68) * 10) / 10);
    expect(Math.round(t.values.sodium_mg!)).toBe(Math.round(2.7 + 102.5 + 1.2));
    expect(t.missing.sat_fat_g).toBe(0);
  });

  it('never fills a missing value with zero', () => {
    const muesli = p100({ energy_kj: 1620, sat_fat_g: null, protein_g: 10.2 });
    const t = sumEntries([
      { per100: muesli, grams: 60 },
      { per100: p100({ energy_kj: 100, sat_fat_g: 1 }), grams: 100 },
    ]);
    expect(t.values.sat_fat_g).toBe(1);
    expect(t.missing.sat_fat_g).toBe(1);
    expect(scale(muesli, 60).sat_fat_g).toBeNull();
  });

  it('shows salt beside sodium', () => {
    expect(saltText(1240)).toBe('3.1 g salt');
    expect(saltText(9)).toBe('0.02 g salt');
  });
});

describe('the ring', () => {
  it('splits energy so the four segments add up exactly to energy logged', () => {
    const s = splitEnergy(2000, { protein: 20, carbs: 50, fat: 10 });
    expect(s.protein + s.carbs + s.fat + s.other).toBeCloseTo(2000, 9);
    expect(s.other).toBeCloseTo(2000 - 20 * 17 - 50 * 17 - 10 * 37, 9);
    // Label rounding: macros explain more than logged, so they're scaled down.
    const r = splitEnergy(1000, { protein: 20, carbs: 40, fat: 10 });
    expect(r.other).toBe(0);
    expect(r.protein + r.carbs + r.fat).toBeCloseTo(1000, 9);
  });

  it('draws a second lap when over target', () => {
    const g = ringGeometry({ size: 280, stroke: 26, rail: 5, target: 2180, base: 1770, eaten: { protein: 414, carbs: 947, fat: 1003, other: 46 }, activity: 'measured' });
    expect(g.over).toBe(true);
    expect(g.lap).not.toBeNull();
    expect(g.remaining).toBeCloseTo(-230, 6);
    expect(g.activity?.dashed).toBe(false);
  });
});

describe('energy target', () => {
  const base = { today: '2026-10-19', birthDate: '1986-05-01', sex: 'male' as const, heightCm: 180, activityLevel: 'some' as const, currentKg: 86.6 };

  it('matches a hand calculation with no burn data', () => {
    // Resting: 10 × 86.6 + 6.25 × 180 − 5 × 40 + 5 = 1,796. Activity: × 0.375 = 673.5.
    // Adjustment: (84 − 86.6) × 7,700 ÷ 62 days = −322.9. Target 2,146.6 → 2,150.
    const t = computeTarget({ ...base, goal: { targetKg: 84, targetDate: '2026-12-20' } });
    expect(t.resting).toBeCloseTo(1796, 6);
    expect(t.activityKind).toBe('estimated');
    expect(t.activity).toBeCloseTo(673.5, 6);
    expect(t.adjustment).toBeCloseTo((-2.6 * 7700) / 62, 6);
    expect(t.rounded).toBe(2150);
  });

  it('rises by measured active burn, shown as its own part', () => {
    const t0 = computeTarget({ ...base, goal: null, burnToday: { date: '2026-10-19', total_kcal: null, active_kcal: 0 } });
    const t = computeTarget({ ...base, goal: null, burnToday: { date: '2026-10-19', total_kcal: 2206, active_kcal: 410 } });
    expect(t.activityKind).toBe('measured');
    expect(t.rounded - t0.rounded).toBe(410);
    expect(t.rounded - t.base).toBeCloseTo(410, 6);
  });

  it('works out activity as total minus resting when there is only a total', () => {
    const t = computeTarget({ ...base, goal: null, burnToday: { date: '2026-10-19', total_kcal: 2296, active_kcal: null } });
    expect(t.activity).toBeCloseTo(2296 - 1796, 6);
  });

  it('never adds two apps together', () => {
    const rows: BurnRow[] = [
      { date: '2026-10-19', source_app: 'garmin', total_kcal: 2600, active_kcal: 410 },
      { date: '2026-10-19', source_app: 'fit', total_kcal: 2300, active_kcal: 300 },
    ];
    expect(pickBurn(rows, '2026-10-19', null)?.active_kcal).toBe(410);
    expect(pickBurn(rows, '2026-10-19', 'fit')?.active_kcal).toBe(300);
  });

  it('uses the 7-day average in stable mode', () => {
    const week = Array.from({ length: 7 }, (_, i) => ({ date: addDays('2026-10-19', -i - 1), total_kcal: 2500 + i * 10, active_kcal: null }));
    const t = computeTarget({ ...base, goal: null, burnLast7: week, stableMode: true, burnToday: { date: '2026-10-19', total_kcal: 3000, active_kcal: 900 } });
    expect(t.activityKind).toBe('stable');
    expect(t.resting + t.activity).toBeCloseTo(2530, 6);
  });

  it('lets anyone type their own target', () => {
    const t = computeTarget({ ...base, goal: { targetKg: 70, targetDate: '2026-11-01' }, overrideKcal: 1234 });
    expect(t.rounded).toBe(1230);
    expect(t.own).toBe(true);
  });

  it('rounds to the nearest 10 and computes resting energy for women', () => {
    expect(roundTarget(2146.6)).toBe(2150);
    expect(restingKcal({ weightKg: 60, heightCm: 165, age: 30, sex: 'female' })).toBe(600 + 1031.25 - 150 - 161);
  });
});

describe("Daniel's numbers from testing on 20 Oct (one target everywhere)", () => {
  // Male, 46, 178 cm, 85.0 kg, goal 81 kg by 12 Jan 2027; Garmin: 285 active kcal by 7:51 am.
  const profile: Profile = {
    user_id: 'u', display_name: 'Daniel', is_admin: true, birth_date: '1980-01-01', sex: 'male', height_cm: 178, activity_level: 'some',
    energy_target_override_kcal: null, warn_rate_pct_per_week: 1, warn_floor_kcal: null, time_zone: 'Australia/Sydney', energy_unit: 'kcal',
    meal_boundaries: null, widget_nutrients: ['protein', 'sat_fat', 'sodium'], stable_mode: false, burn_source: null, onboarded_at: '2026-10-19',
  };
  const goal: Goal = { id: 'g', start_weight_kg: 85, start_date: '2026-10-20', target_weight_kg: 81, target_date: '2027-01-12', active: true, warnings_dismissed: [], created_at: '' };
  const weighIns = [{ id: 'w', measured_at: '2026-10-19T21:00:00Z', weight_kg: 85, source: 'manual' }];
  const burn: BurnRow[] = [{ date: '2026-10-20', source_app: 'garmin', total_kcal: 880, active_kcal: 285 }];
  const draft = { targetKg: 81, targetDate: '2027-01-12' };

  it('gives 1,738 resting − 367 goal + 285 active = 1,660', () => {
    const t = targetFor({ date: '2026-10-20', profile, weighIns, burn, goal: draft })!;
    expect(Math.round(t.resting)).toBe(1738);
    expect(Math.round(t.adjustment)).toBe(-367);
    expect(t.activityKind).toBe('measured');
    expect(t.activity).toBe(285);
    expect(t.rounded).toBe(1660);
  });

  it('shows the same target on Today and in the Goal screen preview', () => {
    const today = buildDay({ date: '2026-10-20', entries: [], profile, goal, weighIns, burn, targets: [] });
    const preview = evaluateGoal(
      { target_kg: '81', target_date: '2027-01-12', own_target: false, own_target_value: '' },
      {
        sex: 'male', currentKg: 85, today: '2026-10-20', ratePct: 1, floorKcal: null, unit: 'kcal',
        targetFor: (g, o) => targetFor({ date: '2026-10-20', profile, weighIns, burn, goal: g, overrideKcal: o }),
        wholeDayFor: (g, o) => targetFor({ date: '2026-10-20', profile: { ...profile, stable_mode: true }, weighIns, burn: [], goal: g, overrideKcal: o }),
      },
      [],
    );
    expect(preview.breakdown!.rounded).toBe(today.target!.rounded);
    expect(goalLine(preview.breakdown!, 'kcal')).toBe('−367 kcal a day · about 0.33 kg a week');
    expect(todaysTargetLine(preview.breakdown!, 'kcal')).toBe("Today's target 1,660 so far");
    // The guardrails use a whole-day figure, so this morning's low burn doesn't warn.
    expect(preview.check!.warnings).toEqual([]);
  });

  it('estimates 652 active only when there is no burn for today', () => {
    const t = targetFor({ date: '2026-10-20', profile, weighIns, burn: [], goal: draft })!;
    expect(t.activityKind).toBe('estimated');
    expect(Math.round(t.activity)).toBe(652);
    expect(t.rounded).toBe(2020);
  });

  it('writes the caption as the sum, which adds up to the target before rounding', () => {
    for (const b of [burn, [], [{ date: '2026-10-20', source_app: 'garmin', total_kcal: 2400, active_kcal: null }]]) {
      const t = targetFor({ date: '2026-10-20', profile, weighIns, burn: b, goal: draft })!;
      const c = captionParts(t, 'kcal');
      if (c.own) throw new Error('unexpected');
      const n = (x: string) => Number(x.replace(/,/g, ''));
      const sum = n(c.resting) + (c.goal ? (c.goal.sign === '−' ? -1 : 1) * n(c.goal.value) : 0) + n(c.active);
      expect(Math.abs(sum - t.target)).toBeLessThanOrEqual(1.5);
    }
    const measured = captionParts(targetFor({ date: '2026-10-20', profile, weighIns, burn, goal: draft })!, 'kcal');
    expect(measured.text).toBe('1,738 resting − 367 goal + 285 active so far');
    const est = captionParts(targetFor({ date: '2026-10-20', profile, weighIns, burn: [], goal: draft })!, 'kcal');
    expect(est.text).toBe('1,738 resting − 367 goal + 652 active, est.');
    const kj = captionParts(targetFor({ date: '2026-10-20', profile, weighIns, burn, goal: draft })!, 'kj');
    expect(kj.text).toBe('7,270 resting − 1,534 goal + 1,192 active so far');
    const own = captionParts(targetFor({ date: '2026-10-20', profile: { ...profile, energy_target_override_kcal: 1800 }, weighIns, burn, goal: draft })!, 'kcal');
    expect(own).toEqual({ own: true, text: 'Your own target' });
    const gaining = captionParts(targetFor({ date: '2026-10-20', profile, weighIns, burn, goal: { targetKg: 88, targetDate: '2027-01-12' } })!, 'kcal');
    expect(gaining.text).toMatch(/^1,738 resting \+ 275 goal \+ 285 active so far$/);
  });
});

describe('burn guards', () => {
  const base = { today: '2026-10-19', birthDate: '1986-05-01', sex: 'male' as const, heightCm: 180, activityLevel: 'some' as const, currentKg: 86.6, goal: null };

  it('treats a total below resting energy as missing, never negative activity', () => {
    const t = computeTarget({ ...base, burnToday: { date: '2026-10-19', total_kcal: 32, active_kcal: null } });
    expect(t.activityKind).toBe('estimated');
    expect(t.activity).toBeGreaterThan(0);
  });

  it('leaves such days out of the Stable mode average', () => {
    const week = [
      { date: '2026-10-18', total_kcal: 2600, active_kcal: null },
      { date: '2026-10-17', total_kcal: 32, active_kcal: null },
      { date: '2026-10-16', total_kcal: 2400, active_kcal: null },
    ];
    const t = computeTarget({ ...base, burnLast7: week, stableMode: true });
    expect(t.resting + t.activity).toBeCloseTo(2500, 6);
  });

  it('still uses active calories when the total so far is below resting', () => {
    const t = computeTarget({ ...base, burnToday: { date: '2026-10-19', total_kcal: 880, active_kcal: 285 } });
    expect(t.activityKind).toBe('measured');
    expect(t.activity).toBe(285);
  });
});

describe('guardrails', () => {
  const g = { today: '2026-10-19', currentKg: 86.6, sex: 'male' as const, maintenanceKcal: 2470 };

  it('warns when a goal is faster than 1% a week, and Continue anyway clears it', () => {
    const c = checkGoal({ ...g, targetKg: 80, targetDate: '2026-11-19', targetKcal: 800 });
    expect(c.refusal).toBeNull();
    expect(c.warnings.map((w) => w.key)).toEqual(['rate', 'floor']);
    expect(c.warnings[0].body).toMatch(/At 1% a week you'd get there by/);
    const after = checkGoal({ ...g, targetKg: 80, targetDate: '2026-11-19', targetKcal: 800, dismissed: ['rate', 'floor'] });
    expect(after.warnings).toEqual([]);
  });

  it('warns below the floor (1,200 women, 1,500 men), and the floor is editable', () => {
    expect(checkGoal({ ...g, targetKg: 85, targetDate: '2027-01-30', targetKcal: 1450 }).warnings.map((w) => w.key)).toEqual(['floor']);
    expect(checkGoal({ ...g, sex: 'female', targetKg: 85, targetDate: '2027-01-30', targetKcal: 1450 }).warnings).toEqual([]);
    expect(checkGoal({ ...g, targetKg: 85, targetDate: '2027-01-30', targetKcal: 1450, floorKcal: 1400 }).warnings).toEqual([]);
  });

  it('refuses a date in the past, showing the earliest reachable date', () => {
    const c = checkGoal({ ...g, targetKg: 84, targetDate: '2026-10-01', targetKcal: 2000 });
    expect(c.refusal?.reason).toBe('date_passed');
    // 2.6 kg × 7,700 ÷ 1,000 a day = 20.02 → 21 days.
    expect(c.refusal?.earliestDate).toBe('2026-11-09');
  });

  it('refuses a goal that would need a negative target', () => {
    const c = checkGoal({ ...g, targetKg: 80.6, targetDate: '2026-10-31', targetKcal: -1000 });
    expect(c.refusal?.reason).toBe('impossible');
  });

  it("never warns about a person's own number", () => {
    expect(checkGoal({ ...g, targetKg: 80, targetDate: '2026-11-19', targetKcal: 800, overrideKcal: 900 }).warnings).toEqual([]);
  });

  it('flags nutrient minimums that alone exceed the energy target', () => {
    expect(targetsConflict([{ nutrient: 'protein', direction: 'min', low: 400, high: null }], 1500)).toMatch(/more than today's target/);
    expect(targetsConflict([{ nutrient: 'protein', direction: 'min', low: 150, high: null }], 2000)).toBeNull();
  });
});

describe('nutrient target bars', () => {
  it('ticks protein at 150 g', () => {
    expect(targetState({ value: 149.9, direction: 'atLeast', max: 150, unit: 'g' }).reached).toBe(false);
    const s = targetState({ value: 150, direction: 'atLeast', max: 150, unit: 'g' });
    expect(s.reached).toBe(true);
    expect(s.caption).toBe('Reached');
  });

  it('turns sat fat the soft warning tone at 6.3 g and the warning tone above 7 g', () => {
    expect(targetState({ value: 6.2, direction: 'noMoreThan', max: 7, unit: 'g' }).tone).toBe('neutral');
    expect(targetState({ value: 6.3, direction: 'noMoreThan', max: 7, unit: 'g' }).tone).toBe('near');
    expect(targetState({ value: 7, direction: 'noMoreThan', max: 7, unit: 'g' }).tone).toBe('near');
    const over = targetState({ value: 7.1, direction: 'noMoreThan', max: 7, unit: 'g' });
    expect(over.tone).toBe('over');
    expect(over.caption).toBe('▲ 0.1 g over');
  });

  it('marks the band for a range', () => {
    const s = targetState({ value: 140, direction: 'range', min: 150, max: 250, unit: 'g' });
    expect(s.caption).toBe('10 g below the range');
    expect(s.band).toEqual({ left: 0.5, width: 100 / 300 });
  });
});

describe('local days', () => {
  it('keeps 11:30 pm on that day in Sydney', () => {
    const at = zonedToUtc('2026-10-19', '23:30', 'Australia/Sydney');
    expect(at.toISOString()).toBe('2026-10-19T12:30:00.000Z');
    expect(localDate('Australia/Sydney', at)).toBe('2026-10-19');
    const { start, end } = dayBounds('Australia/Sydney', '2026-10-19');
    expect(at >= start && at < end).toBe(true);
  });

  it('handles the daylight-saving change (4 Oct 2026 is a 23-hour day in Sydney)', () => {
    const { start, end } = dayBounds('Australia/Sydney', '2026-10-04');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('picks the meal from the time of day', () => {
    expect(mealForTime('07:30')).toBe('breakfast');
    expect(mealForTime('12:40')).toBe('lunch');
    expect(mealForTime('15:00')).toBe('snack');
    expect(mealForTime('18:45')).toBe('dinner');
    expect(mealForTime('23:30')).toBe('snack');
    expect(mealForTime('02:00')).toBe('snack');
  });

  it('keeps age current', () => {
    expect(ageOn('1986-10-20', '2026-10-19')).toBe(39);
    expect(ageOn('1986-10-19', '2026-10-19')).toBe(40);
  });
});

describe('barcodes', () => {
  it('treats a 12-digit UPC-A and its 13-digit EAN form as the same product', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452');
    expect(normalizeBarcode('0036000291452')).toBe('0036000291452');
    expect(normalizeBarcode('00036000291452')).toBe('0036000291452');
    expect(barcodeVariants('0036000291452')).toEqual(['0036000291452', '036000291452']);
  });

  it('expands UPC-E and keeps EAN-8', () => {
    expect(upcEToUpcA('04252614')).toBe('042100005264');
    expect(normalizeBarcode('04252614', 'upc_e')).toBe('0042100005264');
    expect(normalizeBarcode('96385074', 'ean_8')).toBe('96385074');
    expect(normalizeBarcode('abc')).toBeNull();
  });

  it('checks GS1 check digits', () => {
    expect(hasValidCheckDigit('4006381333931')).toBe(true);
    expect(hasValidCheckDigit('4006381333932')).toBe(false);
  });
});

describe('typed amounts', () => {
  it('reads "45 salad", "salad 45g" and "250ml milk"', () => {
    expect(parseSearch('45 salad')).toEqual({ text: 'salad', amount: 45, unit: 'g', count: null });
    expect(parseSearch('salad 45g')).toEqual({ text: 'salad', amount: 45, unit: 'g', count: null });
    expect(parseSearch('250ml milk')).toEqual({ text: 'milk', amount: 250, unit: 'ml', count: null });
    expect(parseSearch('1.5 kg rice')).toEqual({ text: 'rice', amount: 1500, unit: 'g', count: null });
    expect(parseSearch('banana')).toEqual({ text: 'banana', amount: null, unit: null, count: null });
  });

  it('reads small bare numbers as counts', () => {
    expect(parseSearch('2 eggs')).toEqual({ text: 'eggs', amount: null, unit: null, count: 2 });
    expect(parseSearch('a banana').count).toBe(1);
  });

  it('splits typed meals', () => {
    const items = parseText('45 g salad, 2 eggs, flat white and 30 g almonds');
    expect(items.map((i) => [i.text, i.amount, i.count])).toEqual([
      ['salad', 45, null],
      ['eggs', null, 2],
      ['flat white', null, null],
      ['almonds', 30, null],
    ]);
  });

  it('cleans what is typed in the amount field', () => {
    expect(cleanTyped('4,5')).toBe('4.5');
    expect(cleanTyped('1.2.3g')).toBe('1.23');
    expect(parseTyped('45')).toBe(45);
    expect(parseTyped('')).toBeNull();
    expect(parseTyped('0')).toBeNull();
  });
});

describe('amount sheet chips', () => {
  const base = { name: 'Muesli', display_name: null, is_liquid: false, density_g_per_ml: null, total_weight_g: null, serves: null };
  const food = { ...base, source: 'off' as const, serving_g: 45, pack_g: 750 };
  const m = (id: string, label: string, grams: number, rank: number, owner: string | null = null) => ({ id, food_id: 'f', label, grams, source: 'ausnut' as const, owner_id: owner, rank });
  const stat = (o: Partial<FoodStats>): FoodStats => ({ food_id: 'f', use_count: 3, last_used_at: null, last_grams: null, last_unit: null, last_amount: null, last_measure: null, ...o });

  it("orders last amount, serve, pack, then measures, as the brief says; at most five; no repeats", () => {
    const ms = [m('a', '1 cup', 30, 0), m('b', '1 tbsp', 45, 1), m('c', '1 bowl', 60, 2), m('d', '1 handful', 20, 3), m('e', '1 mine', 320, 0, 'u')];
    const chips = buildChips(food, unitOptions(food, ms), stat({ last_grams: 45, last_unit: 'g', last_amount: 45 }));
    expect(chips.map((c) => c.label)).toEqual(['Last · 45 g', 'Whole pack · 750 g', '1 mine · 320 g', '1 cup · 30 g', '1 bowl · 60 g']);
  });

  it('adds another measure on a second tap', () => {
    expect(measureChipLabel({ key: 'm', label: '1 cup · 40 g', grams: 40, kind: 'measure' }, 2)).toBe('2 × 1 cup · 80 g');
    const cup = { kind: 'measure' as const, label: 'regular cup', grams: 285.6, hint: '280 ml', estimate: true, countable: true };
    expect(measureChipLabel({ key: 'c', label: '1 regular cup · 280 ml', grams: 285.6, unit: cup, kind: 'measure' }, 2)).toBe('2 × 1 regular cup · 560 ml');
  });

  it('offers one serve, half and whole for a meal', () => {
    const meal = { ...base, source: 'meal' as const, serving_g: null, pack_g: null, total_weight_g: 1200, serves: 4 };
    const chips = buildChips(meal, unitOptions(meal, []), null);
    expect(chips.map((c) => c.label)).toEqual(['1 serve · 300 g', 'Half · 600 g', 'Whole · 1,200 g']);
  });

  it('works out a meal per 100 g, and 300 g of 1,200 g is a quarter', () => {
    const a = p100({ energy_kj: 1500, protein_g: 12, sodium_mg: 5 });
    const b = p100({ energy_kj: 900, protein_g: 20, sodium_mg: 70 });
    const { per100, totalWeight } = mealPer100(
      [
        { per100: a, grams: 500 },
        { per100: b, grams: 500 },
      ],
      { cookedWeight: 1200, originalRawSum: 1000 },
    );
    expect(totalWeight).toBe(1200);
    const quarter = scale(per100, 300);
    expect(quarter.energy_kj).toBeCloseTo((1500 * 5 + 900 * 5) / 4, 9);
    // Dropping an ingredient scales the cooked weight with the raw weight left.
    expect(mealPer100([{ per100: a, grams: 500 }], { cookedWeight: 1200, originalRawSum: 1000 }).totalWeight).toBe(600);
  });
});

describe('units people think in (testing on 20 Oct)', () => {
  // "Coffee, flat white/cappuccino/latte, single shot & cereal based milk (rice/oat)" as FSANZ has it:
  // a density, marked solid, no household measures, no serve size.
  const flatWhite = {
    name: 'Coffee, flat white/cappuccino/latte, single shot & cereal based milk (rice/oat)', display_name: null, source: 'ausnut' as const,
    is_liquid: false, density_g_per_ml: 1.02, serving_g: null, pack_g: null, total_weight_g: null, serves: null,
  };
  const m = (label: string, grams: number, rank = 0) => ({ id: label, food_id: 'f', label, grams, source: 'ausnut' as const, owner_id: null, rank });

  it('gives a coffee ml, café cup chips and kitchen measures, and opens in grams', () => {
    const units = unitOptions(flatWhite, []);
    expect(units.map((u) => u.label)).toEqual(['g', 'ml', 'small cup', 'regular cup', 'large cup', 'cup', 'tbsp', 'tsp']);
    const regular = units.find((u) => u.label === 'regular cup')!;
    expect(regular.grams).toBeCloseTo(280 * 1.02, 6);
    expect(regular.estimate).toBe(true);
    expect(naturalStart(flatWhite, units, null)).toMatchObject({ unit: { kind: 'g' }, amount: null });
    const chips = buildChips(flatWhite, units, null);
    expect(chips.map((c) => c.label)).toEqual(['1 small cup · 220 ml', '1 regular cup · 280 ml', '1 large cup · 350 ml']);
    // A chip fills in grams.
    expect(chips[1].grams).toBeCloseTo(285.6, 6);
  });

  it('keeps FSANZ cup sizes where it has them (espresso), and gives powders no café cups', () => {
    const espresso = { ...flatWhite, name: 'Coffee, espresso' };
    expect(unitOptions(espresso, [m('1 espresso cup, single shot (50 mL)', 50)]).map((u) => u.label)).toEqual(['g', 'ml', 'espresso cup, single shot (50 mL)', 'cup', 'tbsp', 'tsp']);
    const powder = { ...flatWhite, name: 'Coffee mix powder, with beverage whitener' };
    expect(unitOptions(powder, []).some((u) => u.label.endsWith(' cup'))).toBe(false);
  });

  it('offers household measures and a slice of bread as chips, and still opens in grams', () => {
    const apple = { ...flatWhite, name: 'Apple, red skin, unpeeled, raw', density_g_per_ml: null };
    const units = unitOptions(apple, [m('1 small', 120, 0), m('1 medium', 170, 1), m('1 cup, chopped', 125, 2)]);
    expect(naturalStart(apple, units, null)).toMatchObject({ unit: { kind: 'g' }, amount: null });
    expect(buildChips(apple, units, null).map((c) => c.label)).toEqual(['1 small · 120 g', '1 medium · 170 g', '1 cup, chopped · 125 g']);
    const bread = { ...apple, name: 'Bread, white, commercial' };
    expect(buildChips(bread, unitOptions(bread, []), null).map((c) => c.label)).toEqual(['1 slice · 35 g']);
  });

  it('keeps serves and packs as chips that fill in grams, never as units', () => {
    const bar = { ...flatWhite, name: 'ClifBar Crunchy Peanut Butter', source: 'off' as const, density_g_per_ml: null, serving_g: 68, pack_g: 68 };
    const units = unitOptions(bar, []);
    expect(units.map((u) => u.label)).toEqual(['g']);
    expect(naturalStart(bar, units, null)).toMatchObject({ unit: { kind: 'g' }, amount: null });
    expect(buildChips(bar, units, null)).toEqual([{ key: 'serve', label: '1 serve · 68 g', grams: 68, kind: 'serve' }]);
    const juice = { ...flatWhite, name: 'Juice, orange, commercial', is_liquid: true, density_g_per_ml: 1.04 };
    expect(unitOptions(juice, []).map((u) => u.label)).toContain('glass');
  });

  it('reopens on your last amount in grams, and fills "2 eggs" in as grams', () => {
    const units = unitOptions(flatWhite, []);
    const stats = { food_id: 'f', use_count: 2, last_used_at: null, last_grams: 357, last_unit: 'measure' as const, last_amount: 1, last_measure: 'large cup' };
    expect(naturalStart(flatWhite, units, stats)).toMatchObject({ unit: { kind: 'g' }, amount: 357, fromLast: true });
    expect(buildChips(flatWhite, units, stats)[0]).toMatchObject({ label: 'Last · 1 large cup', grams: 357 });
    const egg = { ...flatWhite, name: 'Egg, chicken, whole, raw', density_g_per_ml: null };
    const eggUnits = unitOptions(egg, [m('1 egg', 50)]);
    expect(naturalStart(egg, eggUnits, null, { count: 2 })).toMatchObject({ unit: { kind: 'g' }, amount: 100, chip: { key: 'u:egg', count: 2 } });
  });

  it('converts a prefilled amount when the unit changes, and writes amounts the way people say them', () => {
    const units = unitOptions(flatWhite, []);
    const regular = units.find((u) => u.label === 'regular cup')!;
    expect(convertAmount(237, units[0], regular)).toBe(0.8);
    expect(convertAmount(1, regular, units[0])).toBe(286);
    expect(amountText(1, 'measure', 'regular cup')).toBe('1 regular cup');
    expect(amountText(2, 'measure', 'slice')).toBe('2 × slice');
    expect(amountText(250, 'ml')).toBe('250 ml');
  });
});

describe("what made up today's numbers (27 Oct)", () => {
  const e = (id: string, name: string, grams: number, per: Partial<Per100>, at = '2026-10-27T01:00:00Z'): LogEntry => ({
    id, owner_id: 'u', eaten_at: at, meal: 'breakfast', food_id: null, food_name_snapshot: name, source_snapshot: null, grams, entered_amount: grams,
    entered_unit: 'g', entered_measure: null, per100_snapshot: { ...emptyPer100(), ...per }, ingredient_adjustments: null, is_estimate: false,
    method: 'search', meal_photo_id: null, hc_synced_at: null, created_at: '', updated_at: '',
  });

  it("lists each food's protein, biggest first, with its share, and the foods with no value", () => {
    const b = breakdown(
      [
        e('egg', 'Egg', 102, { protein_g: 12.6 }),
        e('wrap', 'Chicken wrap', 280, { protein_g: 30.7 }),
        e('coffee', 'Long black', 310, { protein_g: 0 }),
        e('bar', 'Mystery bar', 68, { protein_g: null }),
      ],
      'protein_g',
    );
    expect(b.rows.map((r) => r.entry.id)).toEqual(['wrap', 'egg']);
    expect(b.total).toBeCloseTo(85.96 + 12.852, 6);
    expect(b.rows[0].share).toBeCloseTo(85.96 / (85.96 + 12.852), 6);
    expect(b.missing.map((x) => x.id)).toEqual(['bar']);
  });

  it('is empty with nothing logged', () => {
    expect(breakdown([], 'sodium_mg')).toEqual({ total: 0, rows: [], missing: [] });
  });
});

describe('counting eggs (testing on 25 Oct)', () => {
  const base = { display_name: null, source: 'ausnut' as const, is_liquid: false, density_g_per_ml: null, serving_g: null, pack_g: null, total_weight_g: null, serves: null };
  const m = (label: string, grams: number, rank: number) => ({ id: label, food_id: 'f', label, grams, source: 'ausnut' as const, owner_id: null, rank });
  const egg = { ...base, name: 'Egg, chicken, whole, raw' };
  const eggUnits = unitOptions(egg, [m('1 egg', 51, 0)]);

  it('counts a food in its own measure, preferring medium or regular', () => {
    expect(countUnit(egg, eggUnits)?.label).toBe('egg');
    const banana = { ...base, name: 'Banana, cavendish, peeled, raw' };
    const bananaUnits = unitOptions(banana, [m('1 banana, large', 145.6, 0), m('1 banana, medium', 127.4, 1), m('1 banana, small', 71.5, 2)]);
    expect(countUnit(banana, bananaUnits)).toMatchObject({ label: 'banana, medium', grams: 127.4 });
    const bread = { ...base, name: 'Bread, white, commercial' };
    expect(countUnit(bread, unitOptions(bread, [m('1 slice, regular', 33, 0), m('1 cup, crumbs', 45, 1)]))?.label).toBe('slice, regular');
  });

  it('counts a café coffee in regular cups, a product in serves, and a tomato not at all', () => {
    const coffee = { ...base, name: 'Coffee, flat white/cappuccino/latte, single shot & cow\'s milk', density_g_per_ml: 1.02 };
    expect(countUnit(coffee, unitOptions(coffee, []))?.label).toBe('regular cup');
    const cereal = { ...base, name: 'Weet-Bix', source: 'off' as const, serving_g: 30 };
    expect(countUnit(cereal, unitOptions(cereal, []))).toMatchObject({ label: 'serve', grams: 30 });
    const tomato = { ...base, name: 'Tomato, common, raw' };
    expect(countUnit(tomato, unitOptions(tomato, []))).toBeNull();
    expect(countUnit({ ...base, name: 'Tuesday pasta', source: 'meal' as const, total_weight_g: 1200, serves: 4 }, [])).toBeNull();
  });

  it('steps the counter in whole eggs and reads any grams back as eggs', () => {
    const u = countUnit(egg, eggUnits)!;
    expect(stepCount(null, u, 1)).toBe(51);
    expect(stepCount(51, u, 1)).toBe(102);
    expect(countText(102, u)).toBe('2');
    expect(stepCount(102, u, -1)).toBe(51);
    expect(stepCount(51, u, -1)).toBeNull();
    // Typed 80 g: about 1.6 eggs; + goes to 2, − to 1.
    expect(countText(80, u)).toBe('≈ 1.6');
    expect(stepCount(80, u, 1)).toBe(102);
    expect(stepCount(80, u, -1)).toBe(51);
    expect(countText(null, u)).toBe('0');
  });

  it('fills "2 eggs" typed in Search in as two eggs of grams', () => {
    expect(naturalStart(egg, eggUnits, null, { count: 2 })).toMatchObject({ unit: { kind: 'g' }, amount: 102 });
  });

  it('hides AFCD foods that AUSNUT lists under the same name, ignoring case and punctuation', () => {
    const pairs = afcdDuplicates(
      [{ id: 'a1', name: 'Egg, chicken, whole, raw' }, { id: 'a2', name: 'Banana, cavendish, peeled, raw' }],
      [{ id: 'f1', name: 'Egg, chicken, whole, raw' }, { id: 'f2', name: 'egg chicken whole raw' }, { id: 'f3', name: 'Egg, chicken, whole, omega-3 polyunsaturate enriched, raw' }],
    );
    expect(pairs).toEqual([{ afcdId: 'f1', ausnutId: 'a1' }, { afcdId: 'f2', ausnutId: 'a1' }]);
  });
});

describe('Open Food Facts mapping', () => {
  it('maps the nine fields, sodium from grams to mg', () => {
    const f = mapOffProduct('9300633603857', {
      product_name: 'Muesli',
      brands: 'Brand, Other',
      nutriments: { 'energy-kj_100g': 1620, proteins_100g: 10.2, fat_100g: 8.9, carbohydrates_100g: 58.4, sugars_100g: 17.6, fiber_100g: 9.1, sodium_100g: 0.015 },
      serving_quantity: 45,
      product_quantity: 750,
    })!;
    expect(f.energy_kj).toBe(1620);
    expect(f.sodium_mg).toBe(15);
    expect(f.sat_fat_g).toBeNull();
    expect(f.brand).toBe('Brand');
    expect(f.serving_g).toBe(45);
  });

  it('falls back to kcal × 4.184, and treats no energy as a miss', () => {
    expect(mapOffProduct('1', { nutriments: { 'energy-kcal_100g': 100 } })!.energy_kj).toBe(418.4);
    expect(mapOffProduct('1', { nutriments: { proteins_100g: 5 } })).toBeNull();
  });

  // The real Open Food Facts record for barcode 0722252101204 on 21 Oct 2026: the per-bar values
  // typed in as per 100 g, and sodium in the wrong unit.
  const clifOff = {
    product_name: 'ClifBar Crunchy Peanut Butter',
    brands: 'Clif',
    quantity: '2.40 oz',
    product_quantity: 68.0388555,
    serving_size: '1 bar (68 g)',
    serving_quantity: 68,
    nutrition_data_per: '100g',
    nutriments: {
      'energy-kj': 1203, 'energy-kj_100g': 1203, 'energy-kj_serving': 818, 'energy-kcal_100g': 260, 'energy-kcal_serving': 177,
      proteins: 11, proteins_100g: 11, proteins_serving: 7.48, fat_100g: 8, fat_serving: 5.44, 'saturated-fat_100g': 1, 'saturated-fat_serving': 0.68,
      carbohydrates_100g: 40, carbohydrates_serving: 27.2, sugars_100g: 17, sugars_serving: 11.6, fiber_100g: 5, fiber_serving: 3.4,
      sodium: 3.38e-7, sodium_100g: 3.38e-7, sodium_serving: 2.3e-7,
    },
    data_quality_errors_tags: [],
    data_quality_warnings_tags: ['en:nutrition-value-under-0-001-g-salt', 'en:environmental-score-packaging-packaging-data-missing'],
  };

  it("reads only *_100g: the Clif Bar's wrong record is read faithfully, but flagged and sodium left unknown", () => {
    const f = mapOffProduct('0722252101204', clifOff)!;
    expect([f.protein_g, f.sugars_g, f.energy_kj, f.serving_g]).toEqual([11, 17, 1203, 68]);
    // 0.000000338 g isn't a value a label prints: unknown, never 0.
    expect(f.sodium_mg).toBeNull();
    expect(f.trans_fat_g).toBeNull();
    // Its per-serve values were worked out from per 100 g, so they agree; the tags and sodium flag it.
    expect(f.quality_flags).toEqual(['implausible_value', 'off_quality']);
  });

  it('ignores Open Food Facts tags about packaging or eco-score', () => {
    const f = mapOffProduct('1', { nutriments: { 'energy-kj_100g': 100 }, data_quality_warnings_tags: ['en:environmental-score-packaging-packaging-data-missing'] })!;
    expect(f.quality_flags).toEqual([]);
  });

  it('works out per 100 g from per serve when that is all there is, and flags it', () => {
    const f = mapOffProduct('2', { serving_size: '1 bar (68 g)', nutriments: { 'energy-kj_serving': 1088, proteins_serving: 11.1, sodium_serving: 0.231 } })!;
    expect(f.energy_kj).toBe(1600);
    expect(f.protein_g).toBeCloseTo(16.32, 2);
    expect(f.sodium_mg).toBe(339.7);
    expect(f.quality_flags).toEqual(['derived_from_serving']);
  });

  it('flags per-serve and per-100 g values that disagree by more than 10%', () => {
    const f = mapOffProduct('3', { serving_quantity: 68, nutriments: { 'energy-kj_100g': 1600, proteins_100g: 16.3, proteins_serving: 7.5 } })!;
    expect(f.quality_flags).toEqual(['serving_mismatch']);
    const ok = mapOffProduct('4', { serving_quantity: 68, nutriments: { 'energy-kj_100g': 1600, proteins_100g: 16.3, proteins_serving: 11.1 } })!;
    expect(ok.quality_flags).toEqual([]);
  });

  it('keeps a missing value null and a printed 0 as 0', () => {
    const f = mapOffProduct('5', { nutriments: { 'energy-kj_100g': 0, sodium_100g: 0 } })!;
    expect([f.energy_kj, f.sodium_mg, f.protein_g]).toEqual([0, 0, null]);
  });
});

describe('Clif Bar Crunchy Peanut Butter from its label (21 Oct)', () => {
  // The label's per-100 g column; one bar is 68 g.
  const label = { ...emptyPer100(), energy_kj: 1600, protein_g: 16.3, fat_g: 11.8, sat_fat_g: 2.2, carbs_g: 61.8, sugars_g: 25, fibre_g: 7.4, sodium_mg: 340 };

  it('logging 68 g gives protein 11.1 g, sugars 17.0 g and sodium 231 mg', () => {
    const bar = scale(label, 68);
    expect(nutrientText('protein_g', bar.protein_g)).toBe('11.1 g');
    expect(nutrientText('sugars_g', bar.sugars_g)).toBe('17.0 g');
    expect(nutrientText('sodium_mg', bar.sodium_mg)).toBe('231 mg');
  });

  it('is what one serve fills in on the amount sheet', () => {
    const bar = { name: 'ClifBar Crunchy Peanut Butter', display_name: null, source: 'label' as const, is_liquid: false, density_g_per_ml: null, serving_g: 68, pack_g: null, total_weight_g: null, serves: null };
    const serve = buildChips(bar, unitOptions(bar, []), null).find((c) => c.kind === 'serve')!;
    expect(scale(label, serve.grams).protein_g).toBeCloseTo(11.084, 3);
  });
});

describe('Today and the widget', () => {
  const profile: Profile = {
    user_id: 'u', display_name: 'Daniel', is_admin: true, birth_date: '1986-05-01', sex: 'male', height_cm: 180, activity_level: 'some',
    energy_target_override_kcal: null, warn_rate_pct_per_week: 1, warn_floor_kcal: null, time_zone: 'Australia/Sydney', energy_unit: 'kcal',
    meal_boundaries: null, widget_nutrients: ['protein', 'sat_fat', 'sodium'], stable_mode: false, burn_source: null, onboarded_at: '2026-10-01',
  };
  const entry = (name: string, grams: number, per: Partial<Per100>, meal: LogEntry['meal'] = 'lunch'): LogEntry => ({
    id: name, owner_id: 'u', eaten_at: '2026-10-19T02:00:00Z', meal, food_id: null, food_name_snapshot: name, source_snapshot: null, grams, entered_amount: grams,
    entered_unit: 'g', entered_measure: null, per100_snapshot: p100(per), ingredient_adjustments: null, is_estimate: false, method: 'search', meal_photo_id: null, hc_synced_at: null,
    created_at: '', updated_at: '',
  });

  it('builds the day: incomplete sat fat, rows, groups and a widget summary', () => {
    const day = buildDay({
      date: '2026-10-19',
      entries: [entry('Muesli', 60, { energy_kj: 1620, protein_g: 10.2, sat_fat_g: null, sodium_mg: 15 }, 'breakfast'), entry('Wrap', 280, { energy_kj: 1158, protein_g: 12, sat_fat_g: 2, sodium_mg: 400 })],
      profile,
      goal: { id: 'g', start_weight_kg: 88, start_date: '2026-08-31', target_weight_kg: 84, target_date: '2026-12-20', active: true, warnings_dismissed: [], created_at: '' },
      weighIns: [{ id: 'w', measured_at: '2026-10-19T00:00:00Z', weight_kg: 86.6, source: 'manual' }],
      burn: [{ date: '2026-10-19', source_app: 'garmin', total_kcal: 2206, active_kcal: 410 }],
      targets: [
        { nutrient: 'protein', direction: 'min', low: 150, high: null },
        { nutrient: 'sat_fat', direction: 'max', low: null, high: 7 },
      ],
    });
    const sat = day.targetRows.find((r) => r.info.id === 'sat_fat')!;
    expect(sat.incomplete).toBe(1);
    expect(sat.value).toBeCloseTo(5.6, 9);
    expect(day.ring?.activity).toBe('measured');
    expect(day.ring!.target - day.ring!.base).toBeCloseTo(410, 6);
    expect(day.eaten.protein + day.eaten.carbs + day.eaten.fat + day.eaten.other).toBeCloseTo(day.eatenTotal, 9);
    expect(day.groups.map((g) => g.meal)).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    expect(day.otherNutrients[0].info.key).toBe('sodium_mg');
    const w = widgetSummary(day, profile, 'https://fatty.test')!;
    expect(w.nutrients.map((n) => n.name)).toEqual(['Protein', 'Saturated fat', 'Sodium']);
    expect(w.nutrients[2].caption).toBe('2.8 g salt'); // 9 + 1,120 mg sodium
    expect(w.date).toBe('2026-10-19');
  });

  it('parses database rows into Per100 with nulls kept', () => {
    expect(toPer100({ energy_kj: '1620', sat_fat_g: null, protein_g: 0 } as unknown as Record<string, unknown>)).toMatchObject({ energy_kj: 1620, sat_fat_g: null, protein_g: 0 });
    const f = { energy_kj: 100 } as Food;
    expect(scale(f, 50).energy_kj).toBe(50);
  });
});

describe('AI fallbacks (item 4 and Q5)', () => {
  it('asks the AI only when search found nothing or matched on spelling alone', () => {
    expect(isWeakMatch(0, null)).toBe(true);
    expect(isWeakMatch(3, 3)).toBe(true);
    expect(isWeakMatch(3, 2)).toBe(false);
    expect(isWeakMatch(1, 1)).toBe(false);
  });

  it('keeps three distinct phrasings and sensible components', () => {
    const r = cleanResolve({
      phrasings: [' coffee, flat white ', 'Coffee, flat white', 'coffee, latte', 'a', 'b'],
      components: [{ name: 'coffee, espresso', grams: 30 }, { name: '', grams: 10 }, { name: 'oat beverage', grams: -5 }],
    });
    expect(r.phrasings).toEqual(['coffee, flat white', 'coffee, latte', 'a']);
    expect(r.components).toEqual([{ name: 'coffee, espresso', grams: 30 }]);
  });

  it('scales cached components to the amount logged', () => {
    const parts = [{ name: 'coffee, espresso', grams: 30 }, { name: 'oat beverage', grams: 210 }];
    // "8 oz flat white with oat milk": 227 g.
    const scaled = componentsForGrams(parts, 227);
    expect(scaled).toEqual([{ name: 'coffee, espresso', grams: 28 }, { name: 'oat beverage', grams: 199 }]);
    expect(componentsForGrams(parts, null)).toEqual(parts);
  });

  it('drops impossible AI estimate values and needs energy', () => {
    const base = { name: 'Chai latte', is_liquid: true, confidence: 'medium' as const };
    const v = cleanEstimate({
      ...base,
      per_100g: { energy_kj: 290.04, protein_g: 3, fat_g: 3, sat_fat_g: 5, trans_fat_g: null, carbs_g: 9, sugars_g: 120, fibre_g: -1, sodium_mg: 40 },
    });
    expect(v).toMatchObject({ energy_kj: 290, sat_fat_g: 3, sugars_g: null, fibre_g: null, sodium_mg: 40 });
    expect(cleanEstimate({ ...base, per_100g: { ...emptyPer100(), energy_kj: 9000 } as never })).toBeNull();
  });

  it('counts AI-estimated values in totals so they can be flagged', () => {
    const p = { ...emptyPer100(), energy_kj: 1000, protein_g: 10 };
    const t = sumEntries([
      { per100: p, grams: 100, ai: true },
      { per100: p, grams: 50 },
    ]);
    expect(t.values.energy_kj).toBe(1500);
    expect(t.ai.energy_kj).toBe(1);
    expect(t.ai.fat_g).toBe(0);
    expect(t.missing.fat_g).toBe(2);
  });
});

describe('Open Food Facts, Australian products (Q3)', () => {
  const row = (o: Record<string, string>) => ({
    code: '9300652010794', product_name: 'Weet-Bix', brands: 'Sanitarium', quantity: '575 g', serving_size: '30 g',
    serving_quantity: '30', product_quantity: '575', 'energy-kj_100g': '1480', 'energy-kcal_100g': '', energy_100g: '1480',
    proteins_100g: '12.1', fat_100g: '1.4', 'saturated-fat_100g': '0.3', 'trans-fat_100g': '', carbohydrates_100g: '67',
    sugars_100g: '2.8', fiber_100g: '11.3', sodium_100g: '0.27', last_modified_t: '1700000000', ...o,
  });

  it('maps a product like a barcode lookup, with a slim raw record', () => {
    const m = mapOffAuRow(row({}));
    expect('food' in m).toBe(true);
    if (!('food' in m)) return;
    expect(m.food).toMatchObject({ source: 'off', source_id: '9300652010794', barcode: '9300652010794', name: 'Weet-Bix', brand: 'Sanitarium', energy_kj: 1480, sodium_mg: 270, serving_g: 30, pack_g: 575 });
    expect(m.food.raw).toEqual({ code: '9300652010794', quantity: '575 g', serving_size: '30 g', last_modified_t: 1700000000 });
  });

  it('drops impossible values and kcal typed as kJ', () => {
    expect(mapOffAuRow(row({ fat_100g: '140' }))).toEqual({ drop: 'impossible value' });
    expect(mapOffAuRow(row({ 'energy-kj_100g': '354', energy_100g: '354' }))).toEqual({ drop: 'energy far below its macros' });
  });

  it('leaves a 0 serving or pack size blank, unless the serving text says how much', () => {
    const blank = mapOffAuRow(row({ serving_quantity: '0', serving_size: '', product_quantity: '0' }));
    expect('food' in blank && [blank.food.serving_g, blank.food.pack_g]).toEqual([null, null]);
    const fromText = mapOffAuRow(row({ serving_quantity: '0', serving_size: '30 g' }));
    expect('food' in fromText && fromText.food.serving_g).toBe(30);
  });

  it('keeps the product but drops a part bigger than its whole', () => {
    const m = mapOffAuRow(row({ 'saturated-fat_100g': '9' }));
    expect('food' in m && m.food.sat_fat_g).toBeNull();
  });
});
