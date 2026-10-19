// Sample data for the development-only /dev preview: the design's sample day (Monday 19 October)
// and the over-target day before it. Illustrative numbers, roughly matching the designs.

import type { Fixtures } from '@/components/app/AppProvider';
import { addDays, zonedToUtc } from '@/lib/dates';
import { emptyPer100, type Per100 } from '@/lib/nutrients';
import type { Food, LogEntry, Measure, MealIngredient, Profile } from '@/lib/types';

const TZ = 'Australia/Sydney';

export const devProfile: Profile = {
  user_id: 'dev-user',
  display_name: 'Daniel',
  is_admin: true,
  birth_date: '1986-05-01',
  sex: 'male',
  height_cm: 180,
  activity_level: 'some',
  energy_target_override_kcal: null,
  warn_rate_pct_per_week: 1,
  warn_floor_kcal: null,
  time_zone: TZ,
  energy_unit: 'kcal',
  meal_boundaries: null,
  widget_nutrients: ['protein', 'sat_fat', 'sodium'],
  stable_mode: false,
  burn_source: null,
  onboarded_at: '2026-08-31T00:00:00Z',
};

const p = (o: Partial<Per100>): Per100 => ({ ...emptyPer100(), ...o });
let n = 0;
function entry(date: string, time: string, meal: LogEntry['meal'], name: string, grams: number, per100: Per100, extra: Partial<LogEntry> = {}): LogEntry {
  const at = zonedToUtc(date, time, TZ).toISOString();
  return {
    id: `e${++n}`,
    owner_id: 'dev-user',
    eaten_at: at,
    meal,
    food_id: null,
    food_name_snapshot: name,
    source_snapshot: 'FSANZ',
    grams,
    entered_amount: grams,
    entered_unit: 'g',
    per100_snapshot: per100,
    ingredient_adjustments: null,
    is_estimate: false,
    method: 'search',
    meal_photo_id: null,
    hc_synced_at: at,
    created_at: at,
    updated_at: at,
    ...extra,
  };
}

const flatWhite = p({ energy_kj: 304, protein_g: 3.4, fat_g: 3.6, sat_fat_g: 1.5, trans_fat_g: 0.1, carbs_g: 4.9, sugars_g: 4.9, fibre_g: 0, sodium_mg: 44 });
const toast = p({ energy_kj: 1208.6, protein_g: 10.5, fat_g: 6, sat_fat_g: 0.5, trans_fat_g: 0, carbs_g: 43, sugars_g: 3, fibre_g: 5.5, sodium_mg: 520 });
const wrap = p({ energy_kj: 1158, protein_g: 30.7, fat_g: 5.25, sat_fat_g: 0.5, trans_fat_g: 0.03, carbs_g: 27.8, sugars_g: 8.1, fibre_g: 4.6, sodium_mg: 193 });
const almonds = p({ energy_kj: 2650, protein_g: 21.2, fat_g: 50, sat_fat_g: 3.9, trans_fat_g: 0, carbs_g: 4.8, sugars_g: 4.3, fibre_g: 8.8, sodium_mg: 1 });
const muesli = p({ energy_kj: 1620, protein_g: 10.2, fat_g: 8.9, sat_fat_g: null, trans_fat_g: 0, carbs_g: 58.4, sugars_g: 17.6, fibre_g: 9.1, sodium_mg: 15 });
const milk = p({ energy_kj: 274, protein_g: 3.4, fat_g: 3.6, sat_fat_g: 2.3, trans_fat_g: 0.1, carbs_g: 4.8, sugars_g: 4.8, fibre_g: 0, sodium_mg: 41 });
const bananaBread = p({ energy_kj: 1370, protein_g: 5.5, fat_g: 16, sat_fat_g: 8, trans_fat_g: 0.4, carbs_g: 44, sugars_g: 24, fibre_g: 2, sodium_mg: 300 });
const pasta = p({ energy_kj: 786, protein_g: 10.1, fat_g: 6.5, sat_fat_g: 2.6, trans_fat_g: 0.2, carbs_g: 20.9, sugars_g: 2.2, fibre_g: 1.4, sodium_mg: 102 });
const salad = p({ energy_kj: 74, protein_g: 1.3, fat_g: 0.2, sat_fat_g: 0.03, trans_fat_g: 0, carbs_g: 1.6, sugars_g: 1.3, fibre_g: 2, sodium_mg: 20 });

export function devFixtures(today: string): Fixtures {
  const y = addDays(today, -1);
  const food = (id: string, name: string, source: Food['source'], per: Per100, extra: Partial<Food> = {}): Food => ({
    ...per,
    id,
    source,
    source_id: null,
    visibility: source === 'meal' || source === 'user' ? 'private' : 'shared',
    created_by: null,
    barcode: null,
    name,
    display_name: name,
    brand: null,
    serving_g: null,
    pack_g: null,
    total_weight_g: null,
    cooked_weight_g: null,
    serves: null,
    is_liquid: false,
    density_g_per_ml: null,
    missing_nutrients: [],
    derived_from_food_id: null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...extra,
  });
  const measure = (id: string, foodId: string, label: string, grams: number): Measure => ({ id, food_id: foodId, label, grams, source: 'ausnut', owner_id: null, rank: 0 });
  const pastaIngredients: MealIngredient[] = [
    ['Spaghetti, dry', 500, p({ energy_kj: 1500, protein_g: 12.5, fat_g: 1.5, sat_fat_g: 0.3, trans_fat_g: 0, carbs_g: 71, sugars_g: 3, fibre_g: 3, sodium_mg: 5 })],
    ['Passata', 400, p({ energy_kj: 140, protein_g: 1.5, fat_g: 0.2, sat_fat_g: 0, trans_fat_g: 0, carbs_g: 5.5, sugars_g: 4.5, fibre_g: 1.2, sodium_mg: 180 })],
    ['Beef mince', 500, p({ energy_kj: 900, protein_g: 20, fat_g: 15, sat_fat_g: 6.5, trans_fat_g: 0.6, carbs_g: 0, sugars_g: 0, fibre_g: 0, sodium_mg: 70 })],
    ['Brown onion', 150, p({ energy_kj: 150, protein_g: 1.2, fat_g: 0.1, sat_fat_g: 0, trans_fat_g: 0, carbs_g: 6.5, sugars_g: 4.5, fibre_g: 1.8, sodium_mg: 4 })],
    ['Olive oil', 20, p({ energy_kj: 3700, protein_g: 0, fat_g: 100, sat_fat_g: 14, trans_fat_g: 0, carbs_g: 0, sugars_g: 0, fibre_g: 0, sodium_mg: 0 })],
    ['Parmesan', 60, p({ energy_kj: 1680, protein_g: 35, fat_g: 29, sat_fat_g: 18.5, trans_fat_g: 1, carbs_g: 0, sugars_g: 0, fibre_g: 0, sodium_mg: 1450 })],
  ].map(([name, grams, per], i) => ({
    id: `mi${i}`,
    meal_food_id: 'meal-pasta',
    ingredient_food_id: `ing${i}`,
    grams: grams as number,
    position: i,
    food: food(`ing${i}`, name as string, 'ausnut', per as Per100),
  }));

  return {
    goal: { id: 'goal', start_weight_kg: 88, start_date: '2026-08-31', target_weight_kg: 84, target_date: '2026-12-20', active: true, warnings_dismissed: [], created_at: '2026-08-31T00:00:00Z' },
    weighIns: [
      ['2026-08-31', 88.0], ['2026-09-04', 87.8], ['2026-09-09', 87.9], ['2026-09-14', 87.5], ['2026-09-19', 87.6], ['2026-09-24', 87.2],
      ['2026-09-29', 87.3], ['2026-10-03', 87.0], ['2026-10-07', 86.9], ['2026-10-11', 86.9], ['2026-10-15', 86.7], [today, 86.6],
    ].map(([d, kg], i) => ({ id: `w${i}`, measured_at: zonedToUtc(d as string, '07:00', TZ).toISOString(), weight_kg: kg as number, source: 'manual' })),
    burn: [
      { date: today, source_app: 'com.garmin.android.apps.connectmobile', total_kcal: 2206, active_kcal: 410 },
      ...Array.from({ length: 7 }, (_, i) => ({ date: addDays(today, -i - 1), source_app: 'com.garmin.android.apps.connectmobile', total_kcal: 2350 + ((i * 37) % 200), active_kcal: 450 + ((i * 53) % 250) })),
    ],
    targets: [
      { nutrient: 'protein', direction: 'min', low: 150, high: null },
      { nutrient: 'sat_fat', direction: 'max', low: null, high: 7 },
      { nutrient: 'carbs', direction: 'range', low: 150, high: 250 },
    ],
    aiKey: null,
    days: {
      [today]: [
        entry(today, '07:40', 'breakfast', 'Flat white', 220, flatWhite, { entered_unit: 'ml', entered_amount: 220 }),
        entry(today, '07:45', 'breakfast', 'Vegemite on toast, 2 slices', 116, toast),
        entry(today, '12:40', 'lunch', 'Chicken & salad wrap', 280, wrap),
        entry(today, '15:30', 'snack', 'Almonds', 30, almonds),
        entry(today, '15:35', 'snack', 'Chai latte', 250, p({ energy_kj: 290, protein_g: 3, fat_g: 3, sat_fat_g: 2, trans_fat_g: null, carbs_g: 9, sugars_g: 8, fibre_g: 0, sodium_mg: 40 }), {
          source_snapshot: 'AI estimate',
          entered_unit: 'ml',
          entered_amount: 250,
        }),
      ],
      [y]: [
        entry(y, '07:30', 'breakfast', 'Untoasted fruit muesli', 60, muesli),
        entry(y, '07:31', 'breakfast', 'Milk, full cream', 200, milk, { entered_unit: 'ml', entered_amount: 200 }),
        entry(y, '07:50', 'breakfast', 'Flat white', 220, flatWhite, { entered_unit: 'ml', entered_amount: 220 }),
        entry(y, '12:30', 'lunch', 'Chicken & salad wrap', 280, wrap),
        entry(y, '15:00', 'snack', 'Almonds', 30, almonds),
        entry(y, '15:10', 'snack', 'Banana bread', 110, bananaBread),
        entry(y, '19:00', 'dinner', 'Tuesday pasta', 300, pasta, { source_snapshot: 'Meal' }),
        entry(y, '20:30', 'dinner', 'Chocolate, milk', 60, p({ energy_kj: 2240, protein_g: 7.5, fat_g: 30, sat_fat_g: 18.5, trans_fat_g: 0.3, carbs_g: 57, sugars_g: 55, fibre_g: 1.5, sodium_mg: 80 })),
      ],
    },
    foods: {
      salad: {
        food: food('salad', 'Mixed salad leaves', 'ausnut', salad),
        measures: [measure('m-cup', 'salad', '1 cup', 30)],
        stats: { food_id: 'salad', use_count: 4, last_used_at: '2026-10-18T02:00:00Z', last_grams: 45, last_unit: 'g', last_amount: 45 },
      },
      milk: {
        food: food('milk', 'Milk, full cream', 'ausnut', milk, { is_liquid: true, density_g_per_ml: 1.03, serving_g: 250 }),
        measures: [measure('m-glass', 'milk', '1 glass', 258), measure('m-cupm', 'milk', '1 cup', 258)],
        stats: null,
      },
      'meal-pasta': {
        food: food('meal-pasta', 'Tuesday pasta', 'meal', pasta, { total_weight_g: 1850, cooked_weight_g: 1850, serves: 5 }),
        measures: [],
        stats: { food_id: 'meal-pasta', use_count: 3, last_used_at: '2026-10-18T09:00:00Z', last_grams: 300, last_unit: 'g', last_amount: 300 },
        ingredients: pastaIngredients,
      },
    },
  };
}
