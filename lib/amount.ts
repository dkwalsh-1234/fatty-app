// The amount sheet's maths: units, shortcut chips, and the per-100 g values a log entry snapshots.
// The field opens in grams, as the brief says. Chips fill in grams: your last amount, the pack's
// serve and whole pack, typical sizes where the data has none (café cups, a glass, a slice of
// bread) and FSANZ household measures. The unit beside the number can also switch to ml, a kitchen
// measure (cup, tbsp, tsp) or a household or typical measure; never a serve, which is a chip only.

import { amountText, int } from './format';
import { emptyPer100, NUTRIENT_KEYS, type Per100 } from './nutrients';
import type { Food, FoodStats, Measure } from './types';

/** A unit the amount field can be in. Every unit converts to grams. */
export interface AmountUnit {
  kind: 'g' | 'ml' | 'measure';
  /** "g", "ml", or the measure's name: "regular cup", "slice", "tbsp". */
  label: string;
  /** Grams in one of this unit (for ml, the density). */
  grams: number;
  /** Shown beside a measure: "280 ml", "36 g". */
  hint: string | null;
  /** The grams are a typical size or an assumed density, so entries in it are marked estimated. */
  estimate: boolean;
  /** Something you count whole (a slice, a medium apple, a cup of coffee, a serve): opens as 1. */
  countable: boolean;
  /** A kitchen measure (cup, tbsp, tsp) worked out from the density: offered as a unit, not a chip. */
  kitchen?: boolean;
}

/** Australian kitchen measures, offered for anything with a density. */
export const KITCHEN_ML = [
  { label: 'cup', ml: 250, own: /^cups?\b/i },
  { label: 'tbsp', ml: 20, own: /^(tablespoons?|tbsp)\b/i },
  { label: 'tsp', ml: 5, own: /^(teaspoons?|tsp)\b/i },
] as const;

/**
 * Café cup sizes, for coffees, teas and hot chocolates FSANZ lists only per 100 g. A rough guide,
 * to be confirmed: cafés vary, and you can always switch to ml.
 */
export const CAFE_CUPS_ML = [
  { label: 'small cup', ml: 220 },
  { label: 'regular cup', ml: 280 },
  { label: 'large cup', ml: 350 },
] as const;
const GLASS_ML = 250;
const BREAD_SLICE_G = 35;

const CAFE_DRINK = /^(coffee|tea|chai|hot chocolate|drinking chocolate|babyccino|matcha|mocha|latte|cappuccino|flat white|long black|macchiato|iced coffee|iced latte)\b/i;
const NOT_MADE_UP = /\b(powder|beans?|granules|leaves|leaf|dry|dried|mix|bags?|pods?|capsules?)\b/i;
const OTHER_DRINK = /\b(milk|juice|water|soft drink|cola|lemonade|cordial|smoothie|milkshake|shake|kombucha|kefir|soda|tonic|drink|beverage)\b/i;
const NOT_A_DRINK = /\b(chocolate|biscuits?|bar|cereal|powder|cheese|yoghurt|yogurt|ice cream|dessert|custard)\b/i;
/** Measures that are just an amount ("100 millilitres"): the ml and g units already cover them. */
const PLAIN_AMOUNT = /^\d+(\.\d+)?\s*(millilitres?|milliliters?|ml|grams?|g)\b/i;

const g = (n: number) => `${int(n)} g`;

type UnitFood = Pick<Food, 'name' | 'display_name' | 'source' | 'is_liquid' | 'density_g_per_ml' | 'serving_g' | 'pack_g' | 'total_weight_g' | 'serves'>;

export const GRAMS: AmountUnit = { kind: 'g', label: 'g', grams: 1, hint: null, estimate: false, countable: false };

/** A household measure as a unit: "1 slice, regular" → "slice, regular". */
export function measureUnit(m: Pick<Measure, 'label' | 'grams'>): AmountUnit {
  const one = /^1\s+/.test(m.label);
  const label = m.label.replace(/^1\s+/, '').trim();
  return { kind: 'measure', label, grams: m.grams, hint: g(m.grams), estimate: false, countable: one && !KITCHEN_ML.some((k) => k.own.test(label)) };
}

/** Typical sizes where the data has none: café cups, a glass for drinks, a slice of bread. */
export function typicalUnits(food: UnitFood, household: AmountUnit[]): AmountUnit[] {
  const name = (food.display_name ?? food.name).trim();
  const dens = density(food);
  const volume = food.is_liquid || food.density_g_per_ml != null;
  const has = (re: RegExp) => household.some((u) => re.test(u.label));
  const out: AmountUnit[] = [];
  const vol = (label: string, ml: number): AmountUnit => ({ kind: 'measure', label, grams: ml * dens.gPerMl, hint: `${ml} ml`, estimate: true, countable: true });
  if (volume && CAFE_DRINK.test(name) && !NOT_MADE_UP.test(name) && !has(/\bcups?\b/i)) {
    for (const c of CAFE_CUPS_ML) out.push(vol(c.label, c.ml));
  } else if (food.is_liquid && OTHER_DRINK.test(name) && !NOT_A_DRINK.test(name) && !household.length) {
    out.push(vol('glass', GLASS_ML));
  }
  if (/^bread\b/i.test(name) && !has(/\bslices?\b/i)) {
    out.push({ kind: 'measure', label: 'slice', grams: BREAD_SLICE_G, hint: g(BREAD_SLICE_G), estimate: true, countable: true });
  }
  return out;
}

/**
 * Every unit a food can be entered in: grams; ml for drinks and anything with a density; typical
 * sizes; FSANZ household measures (yours first); then cup, tbsp and tsp unless FSANZ already gives
 * that food its own. Serves and packs are chips, not units.
 */
export function unitOptions(food: UnitFood, measures: Measure[]): AmountUnit[] {
  const dens = density(food);
  const volume = food.is_liquid || food.density_g_per_ml != null;
  const sorted = [...measures].sort((a, b) => (a.owner_id ? 0 : 1) - (b.owner_id ? 0 : 1) || a.rank - b.rank);
  const household = sorted.filter((m) => m.grams > 0 && !PLAIN_AMOUNT.test(m.label)).map(measureUnit);
  const out: AmountUnit[] = [GRAMS];
  if (volume) out.push({ kind: 'ml', label: 'ml', grams: dens.gPerMl, hint: null, estimate: dens.assumed, countable: false });
  out.push(...typicalUnits(food, household), ...household);
  if (volume) {
    for (const k of KITCHEN_ML) {
      if (!household.some((u) => k.own.test(u.label))) out.push({ kind: 'measure', label: k.label, grams: k.ml * dens.gPerMl, hint: `${k.ml} ml`, estimate: dens.assumed, countable: false, kitchen: true });
    }
  }
  const seen = new Set<string>();
  return out.filter((u) => {
    const key = u.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The one measure a food is counted in, for the amount sheet's counter and the size shown in search
 * results ("1 egg · 65"): FSANZ's countable household measure (1 egg, 1 slice, 1 banana), preferring
 * medium or regular, else its most-used; else a typical size (a regular café cup, a slice of bread);
 * else a pack's serve. Null when there's nothing natural to count, like a tomato: grams then.
 */
export function countUnit(food: UnitFood, units: AmountUnit[]): AmountUnit | null {
  if (food.source === 'meal') return null;
  const countable = units.filter((u) => u.kind === 'measure' && u.countable);
  const household = countable.filter((u) => !u.estimate);
  const pick =
    household.find((u) => /\b(medium|regular)\b/i.test(u.label)) ??
    household[0] ??
    countable.find((u) => u.label === 'regular cup') ??
    countable[0];
  if (pick) return pick;
  if (food.serving_g) return { kind: 'measure', label: 'serve', grams: food.serving_g, hint: g(food.serving_g), estimate: false, countable: true };
  return null;
}

/** How many of a measure some grams are: 102 g of egg is 2. */
export const countOf = (grams: number | null, unit: AmountUnit) => (grams && unit.grams > 0 ? grams / unit.grams : 0);

/** The counter's − and +: one fewer or one more whole measure, in grams (null at none). */
export function stepCount(grams: number | null, unit: AmountUnit, by: 1 | -1): number | null {
  const n = countOf(grams, unit);
  const next = by > 0 ? Math.floor(n + 1e-6) + 1 : Math.ceil(n - 1e-6) - 1;
  return next > 0 ? Math.round(next * unit.grams * 10) / 10 : null;
}

/** "2", or "≈ 1.6" when the grams aren't a whole number of the measure. */
export function countText(grams: number | null, unit: AmountUnit): string {
  const n = countOf(grams, unit);
  if (!n) return '0';
  return Math.abs(n - Math.round(n)) < 0.02 ? String(Math.round(n)) : `≈ ${(Math.round(n * 10) / 10).toFixed(1)}`;
}

/**
 * Where the amount field starts: in grams, as the brief says. What you typed in Search ("45 salad",
 * "250ml milk", "2 eggs", filled in as grams of the food's first measure); else your last amount,
 * in grams (or ml if that's what you used); else empty.
 */
export function naturalStart(
  food: UnitFood,
  units: AmountUnit[],
  stats: FoodStats | null,
  prefill?: { amount?: number | null; unit?: 'g' | 'ml' | null; count?: number | null },
): { unit: AmountUnit; amount: number | null; fromLast: boolean; chip?: { key: string; count: number } } {
  const ml = units.find((u) => u.kind === 'ml');
  if (prefill?.amount) return { unit: prefill.unit === 'ml' && ml ? ml : GRAMS, amount: prefill.amount, fromLast: false };
  if (prefill?.count) {
    const m = countUnit(food, units);
    if (m) return { unit: GRAMS, amount: Math.round(m.grams * prefill.count * 10) / 10, fromLast: false, chip: { key: `u:${m.label}`, count: prefill.count } };
  }
  if (stats?.last_grams) {
    if (stats.last_unit === 'ml' && stats.last_amount && ml) return { unit: ml, amount: stats.last_amount, fromLast: true };
    return { unit: GRAMS, amount: stats.last_grams, fromLast: true };
  }
  return { unit: GRAMS, amount: null, fromLast: false };
}

export interface AmountChip {
  key: string;
  label: string;
  /** Grams the chip fills in (one of it, for a measure). */
  grams: number;
  kind: 'last' | 'serve' | 'pack' | 'meal-serve' | 'half' | 'whole' | 'measure';
  /** For a measure: its unit, so a second tap can say "2 × 1 regular cup · 560 ml". */
  unit?: AmountUnit;
}

/**
 * At most five chips, in the brief's order: your last amount; the pack's serve size; whole pack;
 * for a meal, one serve, half and the whole meal; then typical sizes and FSANZ household measures
 * (yours first). Every chip fills in grams. Repeats of the same weight are dropped.
 */
export function buildChips(food: UnitFood, units: AmountUnit[], stats: FoodStats | null): AmountChip[] {
  const out: AmountChip[] = [];
  const add = (c: AmountChip) => {
    if (!(c.grams > 0)) return;
    if (out.some((o) => Math.abs(o.grams - c.grams) < 0.5)) return;
    out.push(c);
  };
  if (stats?.last_grams) {
    const last =
      stats.last_unit === 'measure' && stats.last_measure && stats.last_amount
        ? amountText(stats.last_amount, 'measure', stats.last_measure)
        : stats.last_unit === 'ml' && stats.last_amount
          ? `${int(stats.last_amount)} ml`
          : g(stats.last_grams);
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
  for (const u of units) {
    if (u.kind !== 'measure' || u.kitchen) continue;
    add({ key: `u:${u.label}`, label: `1 ${u.label} · ${u.hint}`, grams: u.grams, kind: 'measure', unit: u });
  }
  return out.slice(0, 5);
}

/** Tapping the same measure chip again adds another: "2 × 1 cup · 80 g". */
export function measureChipLabel(chip: AmountChip, count: number): string {
  if (chip.kind !== 'measure' || count <= 1) return chip.label;
  const base = chip.label.split(' · ')[0];
  const hint = chip.unit?.hint;
  const per = hint?.endsWith(' ml') ? `${int(Number(hint.replace(' ml', '')) * count)} ml` : g(chip.grams * count);
  return `${count} × ${base} · ${per}`;
}

/** Density for ml → g. AUSNUT's where known; otherwise 1 g/ml and the entry is marked estimated. */
export function density(food: Pick<Food, 'density_g_per_ml'>): { gPerMl: number; assumed: boolean } {
  return food.density_g_per_ml ? { gPerMl: food.density_g_per_ml, assumed: false } : { gPerMl: 1, assumed: true };
}

export function toGrams(amount: number, unit: 'g' | 'ml', gPerMl: number): number {
  return unit === 'ml' ? amount * gPerMl : amount;
}

/** An amount in a unit, in grams. */
export const unitGrams = (amount: number, unit: AmountUnit) => amount * unit.grams;

/** Switching from an amount nobody typed (a prefill or a chip) converts it; one decimal, or whole grams. */
export function convertAmount(amount: number, from: AmountUnit, to: AmountUnit): number {
  const n = (amount * from.grams) / to.grams;
  return to.kind === 'g' || to.kind === 'ml' ? Math.round(n) : Math.round(n * 10) / 10;
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
