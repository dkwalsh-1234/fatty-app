// Row shapes as the app uses them (numbers parsed, nulls kept).

import type { Meal, MealBoundary } from './dates';
import type { NutrientKey, Per100 } from './nutrients';
import type { ActivityLevel, Direction, Sex, WarningKey } from './target';
import type { FoodSource } from './sources/types';

export type EnergyUnit = 'kcal' | 'kj';

export interface Profile {
  user_id: string;
  display_name: string | null;
  is_admin: boolean;
  birth_date: string | null;
  sex: Sex | null;
  height_cm: number | null;
  activity_level: ActivityLevel | null;
  energy_target_override_kcal: number | null;
  warn_rate_pct_per_week: number;
  warn_floor_kcal: number | null;
  time_zone: string;
  energy_unit: EnergyUnit;
  meal_boundaries: MealBoundary[] | null;
  widget_nutrients: string[];
  stable_mode: boolean;
  burn_source: string | null;
  onboarded_at: string | null;
}

export interface Goal {
  id: string;
  start_weight_kg: number;
  start_date: string;
  target_weight_kg: number;
  target_date: string;
  active: boolean;
  warnings_dismissed: WarningKey[];
  created_at: string;
}

export interface WeighIn {
  id: string;
  measured_at: string;
  weight_kg: number;
  source: string;
}

export interface BurnRow {
  date: string;
  source_app: string;
  total_kcal: number | null;
  active_kcal: number | null;
}

export interface TargetRow {
  nutrient: string;
  direction: Direction;
  low: number | null;
  high: number | null;
}

export interface Food extends Per100 {
  id: string;
  source: FoodSource;
  source_id: string | null;
  visibility: 'shared' | 'private';
  created_by: string | null;
  barcode: string | null;
  name: string;
  display_name: string | null;
  brand: string | null;
  serving_g: number | null;
  pack_g: number | null;
  total_weight_g: number | null;
  cooked_weight_g: number | null;
  serves: number | null;
  is_liquid: boolean;
  density_g_per_ml: number | null;
  missing_nutrients: NutrientKey[];
  derived_from_food_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Measure {
  id: string;
  food_id: string;
  label: string;
  grams: number;
  source: 'ausnut' | 'afcd' | 'pack' | 'user' | 'off';
  owner_id: string | null;
  rank: number;
}

export interface FoodStats {
  food_id: string;
  use_count: number;
  last_used_at: string | null;
  last_grams: number | null;
  last_unit: 'g' | 'ml' | 'measure' | null;
  last_amount: number | null;
  /** The measure's name when last_unit is 'measure': "regular cup", "slice". */
  last_measure?: string | null;
}

export type LogMethod = 'search' | 'barcode' | 'label' | 'photo' | 'text' | 'meal' | 'repeat';

export interface IngredientAdjustment {
  /** Ingredients as logged this time, with grams. Removed ones are left out. */
  ingredients: { food_id: string; name: string; grams: number }[];
  removed: string[];
}

export interface LogEntry {
  id: string;
  owner_id: string;
  eaten_at: string;
  meal: Meal;
  food_id: string | null;
  food_name_snapshot: string;
  source_snapshot: string | null;
  grams: number;
  entered_amount: number;
  entered_unit: 'g' | 'ml' | 'measure';
  /** The measure's name when entered_unit is 'measure': "regular cup", "slice", "tbsp". */
  entered_measure: string | null;
  per100_snapshot: Per100;
  ingredient_adjustments: IngredientAdjustment | null;
  is_estimate: boolean;
  method: LogMethod;
  meal_photo_id: string | null;
  hc_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MealIngredient {
  id: string;
  meal_food_id: string;
  ingredient_food_id: string;
  grams: number;
  position: number;
  food: Food;
}

/** Short source tag on the amount sheet and food detail. */
export const SOURCE_TAG: Record<FoodSource, string> = {
  user: 'Mine',
  meal: 'Meal',
  label: 'Shared label',
  fsanz_branded: 'FSANZ Branded',
  off: 'Open Food Facts',
  ausnut: 'FSANZ',
  afcd: 'FSANZ',
  ai: 'AI estimate',
};

/** Log entries keep where their values came from; this one means the values are an AI estimate. */
export const AI_ESTIMATE_TAG = 'AI estimate';
