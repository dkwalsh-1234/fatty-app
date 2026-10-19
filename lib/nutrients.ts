// The nine values on an Australian nutrition panel, stored per 100 g.
// Missing is not zero: an unknown value is null everywhere, and totals track how many entries lacked it.

export const NUTRIENT_KEYS = [
  'energy_kj',
  'protein_g',
  'fat_g',
  'sat_fat_g',
  'trans_fat_g',
  'carbs_g',
  'sugars_g',
  'fibre_g',
  'sodium_mg',
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
export type Per100 = Record<NutrientKey, number | null>;

export type MacroColour = 'protein' | 'carbs' | 'fat' | 'other' | null;

export interface NutrientInfo {
  key: NutrientKey;
  /** Short id used in targets and settings ("protein", "sat_fat"). */
  id: string;
  label: string;
  /** Used on log-row chips: "sat fat –". */
  short: string;
  unit: 'kJ' | 'g' | 'mg';
  /** The macro colour this nutrient's dot and bar use, if any. */
  colour: MacroColour;
  /** Indented under its parent on label review and nutrition cards. */
  child?: boolean;
}

export const NUTRIENTS: readonly NutrientInfo[] = [
  { key: 'energy_kj', id: 'energy', label: 'Energy', short: 'energy', unit: 'kJ', colour: null },
  { key: 'protein_g', id: 'protein', label: 'Protein', short: 'protein', unit: 'g', colour: 'protein' },
  { key: 'fat_g', id: 'fat', label: 'Fat, total', short: 'fat', unit: 'g', colour: 'fat' },
  { key: 'sat_fat_g', id: 'sat_fat', label: 'Saturated fat', short: 'sat fat', unit: 'g', colour: 'fat', child: true },
  { key: 'trans_fat_g', id: 'trans_fat', label: 'Trans fat', short: 'trans fat', unit: 'g', colour: 'fat', child: true },
  { key: 'carbs_g', id: 'carbs', label: 'Carbohydrate', short: 'carbs', unit: 'g', colour: 'carbs' },
  { key: 'sugars_g', id: 'sugars', label: 'Sugars', short: 'sugars', unit: 'g', colour: 'carbs', child: true },
  { key: 'fibre_g', id: 'fibre', label: 'Dietary fibre', short: 'fibre', unit: 'g', colour: 'other' },
  { key: 'sodium_mg', id: 'sodium', label: 'Sodium', short: 'sodium', unit: 'mg', colour: null },
];

export const NUTRIENT_BY_KEY = Object.fromEntries(NUTRIENTS.map((n) => [n.key, n])) as Record<NutrientKey, NutrientInfo>;
export const NUTRIENT_BY_ID = Object.fromEntries(NUTRIENTS.map((n) => [n.id, n])) as Record<string, NutrientInfo>;

export const KJ_PER_KCAL = 4.184;
export const kjToKcal = (kj: number) => kj / KJ_PER_KCAL;
export const kcalToKj = (kcal: number) => kcal * KJ_PER_KCAL;

export function emptyPer100(): Per100 {
  return Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, null])) as Per100;
}

/** Coerce anything (DB numerics arrive as strings or numbers) into a Per100 with nulls preserved. */
export function toPer100(row: Partial<Record<NutrientKey, unknown>> | null | undefined): Per100 {
  const out = emptyPer100();
  if (!row) return out;
  for (const k of NUTRIENT_KEYS) {
    const v = row[k];
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function missingNutrients(p: Per100): NutrientKey[] {
  return NUTRIENT_KEYS.filter((k) => p[k] == null);
}

/** Nutrients for an amount, from per-100 g values. Unknown stays unknown. */
export function scale(p: Per100, grams: number): Per100 {
  const out = emptyPer100();
  for (const k of NUTRIENT_KEYS) {
    const v = p[k];
    out[k] = v == null ? null : (v * grams) / 100;
  }
  return out;
}

export interface Totals {
  /** Sum of the known values; null only when no entry had a value at all. */
  values: Per100;
  /** How many entries had this nutrient missing. A total is complete only when this is 0. */
  missing: Record<NutrientKey, number>;
  /** How many entries' values for this nutrient are an AI estimate (Q5). Flagged like missing ones. */
  ai: Record<NutrientKey, number>;
  count: number;
}

const zeroes = () => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;

export function emptyTotals(): Totals {
  return {
    values: emptyPer100(),
    missing: zeroes(),
    ai: zeroes(),
    count: 0,
  };
}

/** Add one entry (already scaled to its grams) to running totals. `ai`: its values are an AI estimate. */
export function addTo(t: Totals, amount: Per100, ai = false): Totals {
  const next: Totals = { values: { ...t.values }, missing: { ...t.missing }, ai: { ...t.ai }, count: t.count + 1 };
  for (const k of NUTRIENT_KEYS) {
    const v = amount[k];
    if (v == null) next.missing[k] += 1;
    else {
      next.values[k] = (next.values[k] ?? 0) + v;
      if (ai) next.ai[k] += 1;
    }
  }
  return next;
}

export function sumEntries(entries: { per100: Per100; grams: number; ai?: boolean }[]): Totals {
  return entries.reduce((t, e) => addTo(t, scale(e.per100, e.grams), e.ai), emptyTotals());
}

/** Australian labels list sodium; salt is shown beside it. salt g = sodium mg × 2.5 / 1000. */
export const saltFromSodiumMg = (mg: number) => (mg * 2.5) / 1000;
