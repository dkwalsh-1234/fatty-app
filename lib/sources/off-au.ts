// Open Food Facts, Australian products (Q3): the rows `npm run fetch:off-au` kept from the full
// export, mapped like a barcode lookup (mapOffProduct) so a product looks the same either way.
// Rows with impossible values are dropped rather than guessed at; the report says how many.
//
// Data: Open Food Facts, https://world.openfoodfacts.org, Open Database Licence (ODbL).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ImportReport } from './fsanz-common';
import { NUTRIENT_KEYS, type NutrientKey } from '../nutrients';
import { mapOffProduct, type OffProduct } from './off';
import type { FoodRow, MeasureRow } from './types';

export const OFF_AU_FILE = 'off-au.tsv.gz';

const NUTRIMENT_COLUMNS = [
  'energy-kj_100g',
  'energy-kcal_100g',
  'energy_100g',
  'proteins_100g',
  'fat_100g',
  'saturated-fat_100g',
  'trans-fat_100g',
  'carbohydrates_100g',
  'sugars_100g',
  'fiber_100g',
  'sodium_100g',
];

export type DropReason = 'no energy' | 'impossible value' | 'energy far below its macros' | 'duplicate barcode' | 'barcode already in the label catalogue';

/**
 * One kept row → a foods row, or why it was dropped. Values above 100 g per 100 g, sodium above
 * 40,000 mg, or energy under half of what the macros give (kcal typed as kJ) mean bad data.
 */
export function mapOffAuRow(row: Record<string, string>): { food: FoodRow } | { drop: DropReason } {
  const code = row.code;
  const p: OffProduct = {
    code,
    product_name: row.product_name,
    brands: row.brands,
    quantity: row.quantity,
    serving_size: row.serving_size,
    serving_quantity: row.serving_quantity,
    product_quantity: row.product_quantity,
    nutriments: Object.fromEntries(NUTRIMENT_COLUMNS.filter((c) => row[c] !== '' && row[c] !== undefined).map((c) => [c, row[c]])),
  };
  const food = mapOffProduct(code, p);
  if (!food) return { drop: 'no energy' };
  if (food.energy_kj == null || food.energy_kj > 3900) return { drop: 'impossible value' };
  for (const k of ['protein_g', 'fat_g', 'sat_fat_g', 'trans_fat_g', 'carbs_g', 'sugars_g', 'fibre_g'] as const) {
    if ((food[k] ?? 0) > 100) return { drop: 'impossible value' };
  }
  if ((food.sodium_mg ?? 0) > 40000) return { drop: 'impossible value' };
  const { protein_g: pr, fat_g: fat, carbs_g: carbs } = food;
  if ((pr ?? 0) + (fat ?? 0) + (carbs ?? 0) > 105) return { drop: 'impossible value' };
  if (pr != null && fat != null && carbs != null) {
    const fromMacros = 17 * pr + 37 * fat + 17 * carbs + 8 * (food.fibre_g ?? 0);
    if (fromMacros > 300 && food.energy_kj < fromMacros * 0.5) return { drop: 'energy far below its macros' };
  }
  // A part bigger than its whole is a typo; drop that one value, keep the product.
  if (food.sat_fat_g != null && food.fat_g != null && food.sat_fat_g > food.fat_g + 0.5) food.sat_fat_g = null;
  if (food.sugars_g != null && food.carbs_g != null && food.sugars_g > food.carbs_g + 0.5) food.sugars_g = null;
  // Keep only what identifies the product; the nutrients are already in their columns.
  food.raw = { code, quantity: row.quantity || null, serving_size: row.serving_size || null, last_modified_t: Number(row.last_modified_t) || null };
  food.name = food.name.replace(/\s+/g, ' ').slice(0, 200);
  food.display_name = food.name;
  return { food };
}

export function parseOffAuTsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(Boolean);
  const header = (lines.shift() ?? '').split('\t');
  return lines.map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
  });
}

/** Loads data/raw/off-au.tsv.gz. `skipBarcodes`: products already in the shared label catalogue. */
export async function loadOffAu(dir: string, skipBarcodes: Set<string> = new Set()): Promise<{ foods: FoodRow[]; measures: MeasureRow[]; report: ImportReport }> {
  const path = join(dir, OFF_AU_FILE);
  let text: string;
  try {
    text = gunzipSync(readFileSync(path)).toString('utf8');
  } catch {
    throw new Error(`Couldn't read ${path}. Run npm run fetch:off-au first.`);
  }
  const rows = parseOffAuTsv(text);
  const dropped: Record<string, number> = {};
  const drop = (r: DropReason) => (dropped[r] = (dropped[r] ?? 0) + 1);
  // Newest edit wins when a barcode appears twice.
  const byCode = new Map<string, { food: FoodRow; modified: number }>();
  for (const row of rows) {
    const m = mapOffAuRow(row);
    if ('drop' in m) {
      drop(m.drop);
      continue;
    }
    if (skipBarcodes.has(row.code)) {
      drop('barcode already in the label catalogue');
      continue;
    }
    const modified = Number(row.last_modified_t) || 0;
    const seen = byCode.get(row.code);
    if (seen) drop('duplicate barcode');
    if (!seen || modified > seen.modified) byCode.set(row.code, { food: m.food, modified });
  }
  const foods = [...byCode.values()].map((x) => x.food);
  const nullCounts = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, foods.filter((f) => f[k] == null).length])) as Record<NutrientKey, number>;
  const report: ImportReport = {
    label: 'Open Food Facts, Australian products',
    files: { products: path },
    tables: [{ role: 'products', where: OFF_AU_FILE, dataRows: rows.length, skippedRows: rows.length - foods.length }],
    mapping: [
      { key: 'energy_kj', header: 'energy-kj_100g, else energy_100g, else energy-kcal_100g × 4.184', unit: 'kJ', note: '' },
      { key: 'protein_g', header: 'proteins_100g', unit: 'g', note: '' },
      { key: 'fat_g', header: 'fat_100g', unit: 'g', note: '' },
      { key: 'sat_fat_g', header: 'saturated-fat_100g', unit: 'g', note: '' },
      { key: 'trans_fat_g', header: 'trans-fat_100g', unit: 'g', note: '' },
      { key: 'carbs_g', header: 'carbohydrates_100g', unit: 'g', note: '' },
      { key: 'sugars_g', header: 'sugars_100g', unit: 'g', note: '' },
      { key: 'fibre_g', header: 'fiber_100g', unit: 'g', note: '' },
      { key: 'sodium_mg', header: 'sodium_100g', unit: 'mg', note: 'g × 1000' },
    ],
    extraColumns: [],
    counts: { 'rows in the file': rows.length, 'products to import': foods.length, ...Object.fromEntries(Object.entries(dropped).map(([k, v]) => [`dropped: ${k}`, v])) },
    nullCounts,
    belowLor: 0,
    negative: 0,
    unparsed: [],
    warnings: [],
  };
  return { foods, measures: [], report };
}
