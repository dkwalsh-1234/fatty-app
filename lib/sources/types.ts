// Every data source maps into the same `foods` columns through an adapter, so a new Australian
// dataset can be added without touching the app. Nutrients are per 100 g; null = unknown.

import type { NutrientKey } from '../nutrients';

/** 'ai' is an AI estimate: a private food whose values came from the person's AI provider (Q5). */
export type FoodSource = 'user' | 'label' | 'meal' | 'fsanz_branded' | 'off' | 'ausnut' | 'afcd' | 'ai';

/** A row ready to upsert into `foods` (on source + source_id). */
export type FoodRow = {
  source: FoodSource;
  source_id: string | null;
  visibility: 'shared' | 'private';
  created_by?: string | null;
  barcode?: string | null;
  name: string;
  display_name?: string | null;
  brand?: string | null;
  common_names?: string | null;
  extra_nutrients?: Record<string, number> | null;
  serving_g?: number | null;
  pack_g?: number | null;
  is_liquid?: boolean;
  density_g_per_ml?: number | null;
  raw?: unknown;
  fetched_at?: string | null;
} & Record<NutrientKey, number | null>;

/** A household measure for a food, keyed for idempotent upserts. */
export interface MeasureRow {
  /** source_id of the food this measure belongs to. */
  food_source_id: string;
  label: string;
  grams: number;
  source: 'ausnut' | 'afcd' | 'pack' | 'off';
  /** Unique within the source, e.g. "<food key>#<measure number>". */
  source_key: string;
  /** Lower comes first on the amount sheet. */
  rank: number;
}

/** A one-off file import (AUSNUT, AFCD, and the FSANZ Branded Food Database once it's published). */
export interface FileImportAdapter {
  source: FoodSource;
  /** Human name for logs. */
  label: string;
  /** Reads Daniel's downloaded files in data/raw and yields rows. Throws with a clear message if a column is missing. */
  load(dir: string): Promise<{ foods: FoodRow[]; measures: MeasureRow[] }>;
}

/** A live lookup by barcode (Open Food Facts, and FSANZ Branded later). */
export interface BarcodeLookupAdapter {
  source: FoodSource;
  lookup(barcode: string): Promise<BarcodeLookupResult>;
}

export type BarcodeLookupResult =
  | { status: 'hit'; food: FoodRow; measures: Omit<MeasureRow, 'food_source_id'>[] }
  | { status: 'no_energy' | 'miss' }
  | { status: 'error' | 'rate_limited'; message: string };
