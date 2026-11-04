// Pure helpers for the AI estimate, the last resort the person asks for (Q5). Shared by the server
// and tests.

import type { EstimateResult } from './ai/schemas';
import { NUTRIENT_KEYS, type NutrientKey } from './nutrients';

/** "coffee, espresso" → "Coffee, espresso". */
export const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const LIMITS: Record<NutrientKey, number> = {
  energy_kj: 3900, // pure fat is about 3,700 kJ per 100 g
  protein_g: 100,
  fat_g: 100,
  sat_fat_g: 100,
  trans_fat_g: 100,
  carbs_g: 100,
  sugars_g: 100,
  fibre_g: 100,
  sodium_mg: 40000, // salt is about 39,000 mg sodium per 100 g
};

/** An AI estimate's per-100 g values, with impossible numbers removed. Null when energy is unusable. */
export function cleanEstimate(r: EstimateResult): Record<NutrientKey, number | null> | null {
  const out = {} as Record<NutrientKey, number | null>;
  for (const k of NUTRIENT_KEYS) {
    const v = r.per_100g[k];
    out[k] = v == null || !Number.isFinite(v) || v < 0 || v > LIMITS[k] ? null : Math.round(v * 10) / 10;
  }
  if (out.energy_kj == null || out.energy_kj === 0) return null;
  if (out.sat_fat_g != null && out.fat_g != null && out.sat_fat_g > out.fat_g) out.sat_fat_g = out.fat_g;
  if (out.sugars_g != null && out.carbs_g != null && out.sugars_g > out.carbs_g) out.sugars_g = out.carbs_g;
  return out;
}
