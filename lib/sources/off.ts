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
}

const numOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Maps an Open Food Facts product to a foods row. Returns null when there's no energy value (a miss). */
export function mapOffProduct(barcode: string, p: OffProduct): FoodRow | null {
  const n = p.nutriments ?? {};
  // energy-kj_100g first; energy_100g is also kJ on Open Food Facts; else kcal × 4.184.
  const kj = numOrNull(n['energy-kj_100g']) ?? numOrNull(n['energy_100g']) ?? (numOrNull(n['energy-kcal_100g']) != null ? (numOrNull(n['energy-kcal_100g']) as number) * 4.184 : null);
  if (kj == null) return null;
  const sodiumG = numOrNull(n['sodium_100g']);
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
    energy_kj: Math.round(kj * 10) / 10,
    protein_g: numOrNull(n['proteins_100g']),
    fat_g: numOrNull(n['fat_100g']),
    sat_fat_g: numOrNull(n['saturated-fat_100g']),
    trans_fat_g: numOrNull(n['trans-fat_100g']),
    carbs_g: numOrNull(n['carbohydrates_100g']),
    sugars_g: numOrNull(n['sugars_100g']),
    fibre_g: numOrNull(n['fiber_100g']),
    sodium_mg: sodiumG == null ? null : Math.round(sodiumG * 1000 * 10) / 10,
    serving_g: numOrNull(p.serving_quantity),
    pack_g: numOrNull(p.product_quantity),
    is_liquid: liquid,
    density_g_per_ml: null,
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
