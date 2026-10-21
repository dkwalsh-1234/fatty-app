// Open Food Facts adapter: the v3 product endpoint, only the fields we need, our User-Agent.
// Never their search endpoint (they ban type-ahead use); all name search runs on our own database.

import type { BarcodeLookupAdapter, BarcodeLookupResult, FoodRow } from './types';

export const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'brands',
  'nutriments',
  'serving_quantity',
  'serving_quantity_unit',
  'serving_size',
  'product_quantity',
  'product_quantity_unit',
  'quantity',
  'nutrition_data_per',
  'data_quality_errors_tags',
  'data_quality_warnings_tags',
] as const;

type Nutriments = Record<string, number | string | undefined>;
export interface OffProduct {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  nutriments?: Nutriments;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  serving_size?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  quantity?: string;
  nutrition_data_per?: string;
  /** Arrays from the API; comma-separated strings in the bulk export. */
  data_quality_errors_tags?: string[] | string;
  data_quality_warnings_tags?: string[] | string;
}

/**
 * Why a food's values should be checked against the pack. Shown on the amount sheet as "Check
 * against pack".
 * - derived_from_serving: no per-100 g value, so it was worked out from the per-serve one.
 * - serving_mismatch: the per-serve and per-100 g values disagree by more than 10%.
 * - off_quality: Open Food Facts flags the product's nutrition data itself.
 * - implausible_value: a value no label could print (sodium above 0 but under 0.5 mg per 100 g).
 */
export type QualityFlag = 'derived_from_serving' | 'serving_mismatch' | 'off_quality' | 'implausible_value';

const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Serving and pack sizes must be above 0 (a "0" on Open Food Facts means unknown). */
const positiveOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
};

/** Grams (or ml) in one serve: serving_quantity, else parsed from serving_size ("1 bar (68 g)"). */
export function servingGrams(p: Pick<OffProduct, 'serving_quantity' | 'serving_quantity_unit' | 'serving_size'>): number | null {
  const unit = (p.serving_quantity_unit ?? '').trim().toLowerCase();
  const q = positiveOrNull(p.serving_quantity);
  if (q && (!unit || unit === 'g' || unit === 'ml')) return q;
  const m = (p.serving_size ?? '').match(/(\d+(?:[.,]\d+)?)\s*(g|gr|grams?|ml|millilitres?)\b/i);
  return m ? positiveOrNull(m[1]) : null;
}

/** Open Food Facts' own quality tags, only those about nutrition (not packaging or eco-score). */
export function nutritionQualityTags(p: Pick<OffProduct, 'data_quality_errors_tags' | 'data_quality_warnings_tags'>): string[] {
  const list = (v: string[] | string | undefined) => (Array.isArray(v) ? v : (v ?? '').split(',')).map((t) => t.trim()).filter(Boolean);
  return [...list(p.data_quality_errors_tags), ...list(p.data_quality_warnings_tags)].filter((t) =>
    /nutrition|nutrient|energy|kcal|salt|sodium|sugar|fat|protein|carbohydrate|fib(er|re)|serving/i.test(t),
  );
}

/** Below this, a per-serve value that disagrees with per-100 g is rounding, not an error. */
const ABS_TOLERANCE: Record<string, number> = { energy: 10, 'energy-kj': 10, 'energy-kcal': 3, sodium: 0.005 };

/**
 * One nutrient per 100 g. Only the *_100g field is read. When it's absent but a per-serve value and
 * a serve size are known, per 100 g is worked out from them (flagged). When both are present they
 * must agree within 10% (else flagged). Missing stays null, never 0.
 */
function per100(n: Nutriments, key: string, serveG: number | null, flags: Set<QualityFlag>): number | null {
  const v100 = numOrNull(n[`${key}_100g`]);
  const vServe = numOrNull(n[`${key}_serving`]);
  if (v100 != null) {
    if (vServe != null && serveG) {
      const expected = (v100 * serveG) / 100;
      const gap = Math.abs(vServe - expected);
      if (gap > Math.max(0.1 * Math.max(expected, vServe), ABS_TOLERANCE[key] ?? 0.2)) flags.add('serving_mismatch');
    }
    return v100;
  }
  if (vServe != null && serveG) {
    flags.add('derived_from_serving');
    return (vServe * 100) / serveG;
  }
  return null;
}

const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

/** Maps an Open Food Facts product to a foods row. Returns null when there's no energy value (a miss). */
export function mapOffProduct(barcode: string, p: OffProduct): FoodRow | null {
  const n = p.nutriments ?? {};
  const serveG = servingGrams(p);
  const flags = new Set<QualityFlag>();
  // energy-kj_100g first; energy_100g is also kJ on Open Food Facts; else kcal × 4.184.
  const kcal = per100(n, 'energy-kcal', serveG, flags);
  const kj = per100(n, 'energy-kj', serveG, flags) ?? per100(n, 'energy', serveG, flags) ?? (kcal != null ? kcal * 4.184 : null);
  if (kj == null) return null;
  // Sodium is in grams on Open Food Facts. Above 0 but under 0.5 mg per 100 g is no printed value
  // (the Clif Bar's 0.000000338 g was sodium typed in the wrong unit): unknown, and flagged.
  let sodiumG = per100(n, 'sodium', serveG, flags);
  if (sodiumG != null && sodiumG > 0 && sodiumG * 1000 < 0.5) {
    sodiumG = null;
    flags.add('implausible_value');
  }
  if (nutritionQualityTags(p).length) flags.add('off_quality');
  const unitText = `${p.product_quantity_unit ?? ''} ${p.quantity ?? ''} ${p.serving_quantity_unit ?? ''}`.toLowerCase();
  const liquid = /\bml\b|\bcl\b|\bl\b|litre|liter/.test(unitText);
  const name = (p.product_name || p.product_name_en || '').trim() || `Product ${barcode}`;
  const brand = (p.brands ?? '').split(',')[0]?.trim() || null;
  return {
    source: 'off',
    source_id: barcode,
    visibility: 'shared',
    barcode,
    name,
    display_name: name,
    brand,
    energy_kj: round1(kj),
    protein_g: per100(n, 'proteins', serveG, flags),
    fat_g: per100(n, 'fat', serveG, flags),
    sat_fat_g: per100(n, 'saturated-fat', serveG, flags),
    trans_fat_g: per100(n, 'trans-fat', serveG, flags),
    carbs_g: per100(n, 'carbohydrates', serveG, flags),
    sugars_g: per100(n, 'sugars', serveG, flags),
    fibre_g: per100(n, 'fiber', serveG, flags),
    sodium_mg: sodiumG == null ? null : round1(sodiumG * 1000),
    serving_g: serveG,
    pack_g: positiveOrNull(p.product_quantity),
    is_liquid: liquid,
    density_g_per_ml: null,
    quality_flags: [...flags].sort(),
    raw: p,
    fetched_at: new Date().toISOString(),
  };
}

export function offAdapter(opts: { baseUrl: string; userAgent: string; fetchImpl?: typeof fetch }): BarcodeLookupAdapter {
  const f = opts.fetchImpl ?? fetch;
  return {
    source: 'off',
    async lookup(barcode: string): Promise<BarcodeLookupResult> {
      const url = `${opts.baseUrl}/api/v3/product/${encodeURIComponent(barcode)}?fields=${OFF_FIELDS.join(',')}`;
      const headers: Record<string, string> = { 'User-Agent': opts.userAgent, Accept: 'application/json' };
      // The staging server sits behind basic auth (off:off).
      if (/openfoodfacts\.net/.test(opts.baseUrl)) headers.Authorization = `Basic ${Buffer.from('off:off').toString('base64')}`;
      let res: Response;
      try {
        res = await f(url, { headers, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      } catch {
        return { status: 'error', message: "Couldn't reach Open Food Facts." };
      }
      if (res.status === 404) return { status: 'miss' };
      if (res.status === 429) return { status: 'rate_limited', message: 'Open Food Facts asked us to slow down. Try again in a minute.' };
      if (!res.ok) return { status: 'error', message: `Open Food Facts answered ${res.status}.` };
      const body = (await res.json().catch(() => null)) as { status?: string; product?: OffProduct } | null;
      if (!body?.product || body.status === 'failure') return { status: 'miss' };
      const food = mapOffProduct(barcode, body.product);
      return food ? { status: 'hit', food, measures: [] } : { status: 'no_energy' };
    },
  };
}
