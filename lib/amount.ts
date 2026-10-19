// The amount sheet's maths: shortcut chips, units, and the per-100 g values a log entry snapshots.
// Grams are the default unit everywhere; ml and serves are shortcuts that convert to grams.

import { int } from './format';
import { emptyPer100, NUTRIENT_KEYS, type Per100 } from './nutrients';
import type { Food, FoodStats, Measure } from './types';

export interface AmountChip {
  key: string;
  label: string;
  grams: number;
  kind: 'last' | 'serve' | 'pack' | 'meal-serve' | 'half' | 'whole' | 'measure';
}

const g = (n: number) => `${int(n)} g`;

/**
 * At most five chips, in the brief's order: your last amount; the pack's serve size; whole pack;
 * for a meal, one serve, half and the whole meal; then the most-used household measures.
 * Chips with the same gram value as an earlier one are dropped.
 */
export function buildChips(food: Pick<Food, 'source' | 'serving_g' | 'pack_g' | 'total_weight_g' | 'serves'>, measures: Measure[], stats: FoodStats | null): AmountChip[] {
  const out: AmountChip[] = [];
  const add = (c: AmountChip) => {
    if (!(c.grams > 0)) return;
    if (out.some((o) => Math.abs(o.grams - c.grams) < 0.5)) return;
    out.push(c);
  };
  if (stats?.last_grams) {
    const last = stats.last_unit === 'ml' && stats.last_amount ? `${int(stats.last_amount)} ml` : g(stats.last_grams);
    add({ key: 'last', label: `Last · ${last}`, grams: stats.last_grams, kind: 'last' });
  }
  if (food.source === 'meal') {
    const total = food.total_weight_g ?? 0;
    if (food.serves && total) add({ key: 'serve', label: `1 serve · ${g(total / food.serves)}`, grams: total / food.serves, kind: 'meal-serve' });
    if (total) add({ key: 'half', label: `Half · ${g(total / 2)}`, grams: total / 2, kind: 'half' });
    if (total) add({ key: 'whole', label: `Whole · ${g(total)}`, grams: total, kind: 'whole' });
  } else {
    if (food.serving_g) add({ key: 'serve', label: `1 serve · ${g(food.serving_g)}`, grams: food.serving_g, kind: 'serve' });
    if (food.pack_g) add({ key: 'pack', label: `Whole pack · ${g(food.pack_g)}`, grams: food.pack_g, kind: 'pack' });
  }
  // Your own measures first, then AUSNUT's most-used.
  const sorted = [...measures].sort((a, b) => (a.owner_id ? 0 : 1) - (b.owner_id ? 0 : 1) || a.rank - b.rank);
  for (const m of sorted) add({ key: `m:${m.id}`, label: `${m.label} · ${g(m.grams)}`, grams: m.grams, kind: 'measure' });
  return out.slice(0, 5);
}

/** Tapping the same measure chip again adds another: "2 × 1 cup · 80 g". */
export function measureChipLabel(chip: AmountChip, count: number): string {
  if (chip.kind !== 'measure' || count <= 1) return chip.label;
  const base = chip.label.split(' · ')[0];
  return `${count} × ${base} · ${g(chip.grams * count)}`;
}

/** Density for ml → g. AUSNUT's where known; otherwise 1 g/ml and the entry is marked estimated. */
export function density(food: Pick<Food, 'density_g_per_ml'>): { gPerMl: number; assumed: boolean } {
  return food.density_g_per_ml ? { gPerMl: food.density_g_per_ml, assumed: false } : { gPerMl: 1, assumed: true };
}

export function toGrams(amount: number, unit: 'g' | 'ml', gPerMl: number): number {
  return unit === 'ml' ? amount * gPerMl : amount;
}

/** Parse what's typed in the amount field: digits with one "." or ",". */
export function parseTyped(s: string): number | null {
  const t = s.replace(',', '.').trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Keep only what the amount field accepts. */
export function cleanTyped(s: string): string {
  let t = s.replace(',', '.').replace(/[^\d.]/g, '');
  const i = t.indexOf('.');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '');
  return t.slice(0, 7);
}

/** Amounts shown in the field: whole numbers stay whole, otherwise up to one decimal. */
export function amountString(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Per-100 g of a meal from a list of ingredients (for "Adjust ingredients", this log only).
 * A cooked weight scales with the ingredients left: cooked × (new raw sum / original raw sum).
 */
export function mealPer100(
  ingredients: { per100: Per100; grams: number }[],
  opts: { cookedWeight: number | null; originalRawSum: number },
): { per100: Per100; totalWeight: number } {
  const raw = ingredients.reduce((s, i) => s + i.grams, 0);
  const total = opts.cookedWeight && opts.originalRawSum > 0 ? (opts.cookedWeight * raw) / opts.originalRawSum : raw;
  const out = emptyPer100();
  if (!ingredients.length || total <= 0) return { per100: out, totalWeight: total };
  for (const k of NUTRIENT_KEYS) {
    let sum = 0;
    let missing = false;
    for (const i of ingredients) {
      const v = i.per100[k];
      if (v == null) missing = true;
      else sum += v * i.grams;
    }
    out[k] = missing ? null : sum / total;
  }
  return { per100: out, totalWeight: total };
}
