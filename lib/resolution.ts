// Pure helpers for the AI fallbacks: turning a phrase into database terms (item 4) and, as a last
// resort the person asks for, an AI estimate of the values (Q5). Shared by the server and tests.

import type { EstimateResult, ResolveResult } from './ai/schemas';
import type { Candidate, DraftItem } from './drafts';
import { NUTRIENT_KEYS, type NutrientKey } from './nutrients';

/** What the AI fallback found for a phrase: database foods, a split into parts, or nothing. */
export type Resolution =
  | { kind: 'match'; candidates: Candidate[] }
  | { kind: 'split'; components: { name: string; grams: number; candidates: Candidate[] }[] }
  | { kind: 'none' };

/** /api/resolve-food's answer. A split also comes as meal confirm rows. */
export interface ResolveResponse {
  resolution: Resolution;
  items?: DraftItem[];
  cached: boolean;
}

/** Search found nothing, or matched on spelling only (tier 3): worth asking the AI. */
export const isWeakMatch = (candidates: number, tier: number | null | undefined) => candidates === 0 || tier === 3;

/** "coffee, espresso" → "Coffee, espresso". */
export const sentenceCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** At most three distinct phrasings and six components, with blanks and silly amounts dropped. */
export function cleanResolve(r: ResolveResult): ResolveResult {
  const seen = new Set<string>();
  const phrasings: string[] = [];
  for (const p of r.phrasings ?? []) {
    const t = p.trim().slice(0, 120);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      phrasings.push(t);
    }
  }
  const components = (r.components ?? [])
    .map((c) => ({ name: c.name.trim().slice(0, 120), grams: Number(c.grams) }))
    .filter((c) => c.name && Number.isFinite(c.grams) && c.grams > 0 && c.grams < 5000);
  return { phrasings: phrasings.slice(0, 3), components: components.slice(0, 6) };
}

/**
 * The AI's components were worked out for one amount (and are cached for everyone), so scale them
 * to the amount logged now. Without an amount they stay as the AI's typical serve.
 */
export function componentsForGrams(components: ResolveResult['components'], grams: number | null): ResolveResult['components'] {
  const sum = components.reduce((s, c) => s + c.grams, 0);
  const factor = grams && grams > 0 && sum > 0 ? grams / sum : 1;
  return components.map((c) => ({ name: c.name, grams: Math.max(1, Math.round(c.grams * factor)) }));
}

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
