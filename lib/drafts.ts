// Draft meals for the meal confirm screen, from a meal photo or typed text. Each item is matched
// to foods by the same search as the Search screen, keeping the top three candidates. Nutrients
// always come from the matched food rows, never from the AI.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MealPhotoResult, TextParseResult } from './ai/schemas';
import { parseText, type TextItem } from './parse';

export interface Candidate {
  id: string;
  name: string;
  display_name: string | null;
  brand: string | null;
  source: string;
  is_liquid: boolean;
  density_g_per_ml: number | null;
  serving_g: number | null;
  energy_kj: number | null;
  protein_g: number | null;
  fat_g: number | null;
  sat_fat_g: number | null;
  trans_fat_g: number | null;
  carbs_g: number | null;
  sugars_g: number | null;
  fibre_g: number | null;
  sodium_mg: number | null;
  /** How you last logged it, if you have. */
  last_grams: number | null;
}

export interface DraftItem {
  key: string;
  /** What the AI or the person called it. */
  label: string;
  query: string;
  grams: number | null;
  /** True when grams are an estimate (photo, typical serve). */
  estimate: boolean;
  confidence: 'low' | 'medium' | 'high' | null;
  /** Likely hidden fat: starts unticked. */
  suggested: boolean;
  /** "2 × egg" when converted from a count. */
  note: string | null;
  candidates: Candidate[];
  /** How well search matched (1 every word, 2 some, 3 spelling only); null when nothing matched. */
  tier?: number | null;
  /** Set when the AI split a mixed drink or dish into parts: what it was split from. */
  splitFrom?: string | null;
}

export interface Draft {
  kind: 'photo' | 'text';
  meal_photo_id?: string;
  text_parse_id?: string;
  hint?: string | null;
  text?: string;
  items: DraftItem[];
}

const CANDIDATE_COLS =
  'id, name, display_name, brand, source, is_liquid, density_g_per_ml, serving_g, energy_kj, protein_g, fat_g, sat_fat_g, trans_fat_g, carbs_g, sugars_g, fibre_g, sodium_mg';

const toNum = (v: unknown) => (v == null ? null : Number(v));

function toCandidate(f: Record<string, unknown>, lastGrams: unknown): Candidate {
  return {
    ...(f as unknown as Candidate),
    density_g_per_ml: toNum(f.density_g_per_ml),
    serving_g: toNum(f.serving_g),
    energy_kj: toNum(f.energy_kj),
    protein_g: toNum(f.protein_g),
    fat_g: toNum(f.fat_g),
    sat_fat_g: toNum(f.sat_fat_g),
    trans_fat_g: toNum(f.trans_fat_g),
    carbs_g: toNum(f.carbs_g),
    sugars_g: toNum(f.sugars_g),
    fibre_g: toNum(f.fibre_g),
    sodium_mg: toNum(f.sodium_mg),
    last_grams: toNum(lastGrams),
  };
}

/** One food as a candidate, e.g. an AI estimate just created. */
export async function candidateById(sb: SupabaseClient, id: string): Promise<Candidate | null> {
  const { data } = await sb.from('foods').select(CANDIDATE_COLS).eq('id', id).maybeSingle();
  return data ? toCandidate(data as Record<string, unknown>, null) : null;
}

/**
 * Top three foods for a name, by the same search as the Search screen (so your own foods and
 * history count). `tier` says how good the best match is: 1 = every word, 2 = some, 3 = spelling only.
 */
export async function matchFoods(sb: SupabaseClient, query: string): Promise<{ candidates: Candidate[]; strong: boolean; tier: number | null }> {
  const { data } = await sb.rpc('search_foods', { q: query, lim: 3 });
  const rows = (data as { id: string; score: number; use_count: number | null; last_grams: number | null; tier?: number | null }[]) ?? [];
  if (!rows.length) return { candidates: [], strong: false, tier: null };
  const { data: full } = await sb.from('foods').select(CANDIDATE_COLS).in('id', rows.map((r) => r.id));
  const byId = new Map((full ?? []).map((f) => [f.id as string, f]));
  const candidates = rows
    .map((r) => {
      const f = byId.get(r.id);
      return f ? toCandidate(f as Record<string, unknown>, r.last_grams) : null;
    })
    .filter((c): c is Candidate => c != null);
  const top = rows[0];
  const tier = top.tier == null ? 1 : Number(top.tier);
  // An obvious match: something you've logged before, or every word matched well.
  const strong = (top.use_count ?? 0) > 0 || (tier === 1 && Number(top.score) >= 0.3);
  return { candidates, strong, tier };
}

/** Grams for a count ("2 eggs") from household measures: one that names the noun, else the first listed. */
export async function gramsForCount(sb: SupabaseClient, foodId: string, count: number, noun: string | null): Promise<{ grams: number; note: string } | null> {
  const { data } = await sb.from('food_measures').select('label, grams, rank').eq('food_id', foodId).order('rank').limit(20);
  const measures = (data ?? []).map((m) => ({ label: m.label as string, grams: Number(m.grams) }));
  const word = noun?.toLowerCase().replace(/s$/, '');
  const m =
    (word && measures.find((x) => x.label.toLowerCase().includes(word))) ||
    measures.find((x) => /^1\s/.test(x.label)) ||
    measures[0];
  if (m) return { grams: m.grams * count, note: `${count} × ${m.label}` };
  const { data: f } = await sb.from('foods').select('serving_g').eq('id', foodId).maybeSingle();
  if (f?.serving_g) return { grams: Number(f.serving_g) * count, note: `${count} × 1 serve` };
  return null;
}

/** A hidden-fat suggestion gets a sensible amount from household measures (1 tsp) where there is one. */
async function suggestedGrams(sb: SupabaseClient, foodId: string, aiGrams: number): Promise<{ grams: number; note: string | null }> {
  const { data } = await sb.from('food_measures').select('label, grams').eq('food_id', foodId).limit(30);
  const tsp = (data ?? []).find((m) => /\b1\s*(tsp|teaspoon)/i.test(m.label as string));
  if (tsp) return { grams: Number(tsp.grams), note: '1 tsp' };
  return { grams: aiGrams, note: null };
}

let seq = 0;
export const newKey = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;
const key = newKey;

export async function draftFromPhoto(sb: SupabaseClient, ai: MealPhotoResult): Promise<DraftItem[]> {
  return Promise.all(
    ai.items.map(async (it) => {
      const { candidates, tier } = await matchFoods(sb, it.name);
      let grams = Math.max(1, Math.round(it.grams));
      let note: string | null = null;
      if (it.suggested && candidates[0]) ({ grams, note } = await suggestedGrams(sb, candidates[0].id, grams));
      return {
        key: key(),
        label: it.display_name || it.name,
        query: it.name,
        grams,
        estimate: true,
        confidence: it.confidence,
        suggested: it.suggested,
        note,
        candidates,
        tier,
      };
    }),
  );
}

/** Items from typed text, whether parsed locally or by AI. Counts convert with household measures. */
export async function draftFromText(sb: SupabaseClient, items: (TextItem | (TextParseResult['items'][number] & { raw?: string }))[]): Promise<DraftItem[]> {
  return Promise.all(
    items.map(async (it) => {
      const text = it.text;
      const { candidates, tier } = await matchFoods(sb, text);
      const top = candidates[0];
      let grams: number | null = null;
      let note: string | null = null;
      let estimate = false;
      if (it.amount != null) {
        grams = it.unit === 'ml' && top ? it.amount * (top.density_g_per_ml ?? 1) : it.amount;
        estimate = it.unit === 'ml' && !top?.density_g_per_ml;
        if (it.unit === 'ml') note = `${it.amount} ml`;
      } else if (it.count != null && top) {
        const c = await gramsForCount(sb, top.id, it.count, 'count_noun' in it ? it.count_noun : text);
        if (c) ({ grams, note } = c);
      } else if ('typical_grams' in it && it.typical_grams) {
        grams = it.typical_grams;
        estimate = true;
      } else if (top?.last_grams) {
        grams = top.last_grams;
        note = 'your last amount';
      }
      return {
        key: key(),
        label: 'display_name' in it && it.display_name ? it.display_name : text,
        query: text,
        grams: grams == null ? null : Math.round(grams * 10) / 10,
        estimate,
        confidence: null,
        suggested: false,
        note,
        candidates,
        tier,
      };
    }),
  );
}

/** The local parse is enough when every item has an explicit amount and an obvious match. */
export async function tryLocalText(sb: SupabaseClient, text: string): Promise<DraftItem[] | null> {
  const items = parseText(text);
  if (!items.length || !items.every((i) => i.amount != null)) return null;
  const checks = await Promise.all(items.map((i) => matchFoods(sb, i.text)));
  if (!checks.every((c) => c.strong)) return null;
  return draftFromText(sb, items);
}
