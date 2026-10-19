'use client';

// Browser data access. Search, logging, meals and settings go straight to Supabase under RLS.
// Every function throws a plain Error with a message fit to show.

import { addDays, dayBounds, type Meal } from './dates';
import { NUTRIENT_KEYS, toPer100, type Per100 } from './nutrients';
import { toProfile } from './profile';
import { supabase } from './supabase/browser';
import type { BurnRow, Food, FoodStats, Goal, IngredientAdjustment, LogEntry, LogMethod, Measure, MealIngredient, Profile, TargetRow, WeighIn } from './types';

function fail(e: { message?: string } | null, what: string): never {
  throw new Error(e?.message ? `${what}: ${e.message}` : what);
}

const num = (v: unknown) => (v == null ? null : Number(v));

export function toFood(r: Record<string, unknown>): Food {
  return {
    ...(r as unknown as Food),
    ...toPer100(r),
    serving_g: num(r.serving_g),
    pack_g: num(r.pack_g),
    total_weight_g: num(r.total_weight_g),
    cooked_weight_g: num(r.cooked_weight_g),
    serves: num(r.serves),
    density_g_per_ml: num(r.density_g_per_ml),
    missing_nutrients: (r.missing_nutrients as Food['missing_nutrients']) ?? [],
  };
}

export function toEntry(r: Record<string, unknown>): LogEntry {
  return {
    ...(r as unknown as LogEntry),
    grams: Number(r.grams),
    entered_amount: Number(r.entered_amount),
    entered_measure: (r.entered_measure as string | null) ?? null,
    per100_snapshot: toPer100(r.per100_snapshot as Record<string, unknown>),
  };
}

export async function userId(): Promise<string> {
  const { data } = await supabase().auth.getUser();
  if (!data.user) throw new Error('Please sign in again.');
  return data.user.id;
}

// Profile, goal, weigh-ins, burn, targets -----------------------------------------------------

export async function loadProfile(): Promise<Profile> {
  const { data, error } = await supabase().from('profiles').select('*').single();
  if (error) fail(error, "Couldn't load your profile");
  return toProfile(data);
}

export async function saveProfile(patch: Partial<Profile>): Promise<void> {
  const uid = await userId();
  const { error } = await supabase().from('profiles').update(patch).eq('user_id', uid);
  if (error) fail(error, "Couldn't save");
}

const toGoal = (r: Record<string, unknown>): Goal => ({
  ...(r as unknown as Goal),
  start_weight_kg: Number(r.start_weight_kg),
  target_weight_kg: Number(r.target_weight_kg),
});

export async function loadGoal(): Promise<Goal | null> {
  const { data, error } = await supabase().from('goals').select('*').eq('active', true).maybeSingle();
  if (error) fail(error, "Couldn't load your goal");
  return data ? toGoal(data) : null;
}

/** A changed goal is a new row, so warnings dismissed for the old goal come back. */
export async function saveGoal(g: Omit<Goal, 'id' | 'active' | 'created_at'>): Promise<Goal> {
  const sb = supabase();
  const { error: e1 } = await sb.from('goals').update({ active: false }).eq('active', true);
  if (e1) fail(e1, "Couldn't save your goal");
  const { data, error } = await sb.from('goals').insert({ ...g, active: true }).select('*').single();
  if (error) fail(error, "Couldn't save your goal");
  return toGoal(data);
}

export async function dismissWarnings(goalId: string, keys: string[]): Promise<void> {
  const { error } = await supabase().from('goals').update({ warnings_dismissed: keys }).eq('id', goalId);
  if (error) fail(error, "Couldn't save");
}

export async function loadWeighIns(sinceDate?: string, tz = 'Australia/Sydney'): Promise<WeighIn[]> {
  let q = supabase().from('weigh_ins').select('*').order('measured_at', { ascending: true });
  if (sinceDate) q = q.gte('measured_at', dayBounds(tz, sinceDate).start.toISOString());
  const { data, error } = await q.limit(1000);
  if (error) fail(error, "Couldn't load weigh-ins");
  return (data ?? []).map((w) => ({ ...w, weight_kg: Number(w.weight_kg) }));
}

export async function addWeighIn(weightKg: number, at = new Date()): Promise<void> {
  const { error } = await supabase().from('weigh_ins').insert({ weight_kg: weightKg, measured_at: at.toISOString() });
  if (error) fail(error, "Couldn't save your weight");
}

export async function deleteWeighIn(id: string): Promise<void> {
  const { error } = await supabase().from('weigh_ins').delete().eq('id', id);
  if (error) fail(error, "Couldn't delete");
}

export async function loadBurn(fromDate: string): Promise<BurnRow[]> {
  const { data, error } = await supabase().from('daily_burn').select('date, source_app, total_kcal, active_kcal').gte('date', fromDate);
  if (error) fail(error, "Couldn't load calories burned");
  return (data ?? []).map((b) => ({ ...b, total_kcal: num(b.total_kcal), active_kcal: num(b.active_kcal) }));
}

export async function upsertBurn(rows: BurnRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await supabase()
    .from('daily_burn')
    .upsert(rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() })), { onConflict: 'owner_id,date,source_app' });
  if (error) fail(error, "Couldn't save calories burned");
}

export async function loadTargets(): Promise<TargetRow[]> {
  const { data, error } = await supabase().from('nutrient_targets').select('nutrient, direction, low, high');
  if (error) fail(error, "Couldn't load targets");
  return (data ?? []).map((t) => ({ ...t, low: num(t.low), high: num(t.high) }));
}

export async function saveTarget(t: TargetRow): Promise<void> {
  const { error } = await supabase().from('nutrient_targets').upsert(t, { onConflict: 'owner_id,nutrient' });
  if (error) fail(error, "Couldn't save the target");
}

export async function deleteTarget(nutrient: string): Promise<void> {
  const { error } = await supabase().from('nutrient_targets').delete().eq('nutrient', nutrient);
  if (error) fail(error, "Couldn't remove the target");
}

// Log ------------------------------------------------------------------------------------------

export async function dayEntries(date: string): Promise<LogEntry[]> {
  const { data, error } = await supabase().rpc('day_entries', { d: date });
  if (error) fail(error, "Couldn't load the day");
  return ((data as Record<string, unknown>[]) ?? []).map(toEntry);
}

export interface DailyTotalRow {
  date: string;
  entries: number;
  values: Per100;
  missing: Record<string, number>;
  /** Entries per nutrient whose value is an AI estimate. */
  ai: Record<string, number>;
}

export async function dailyTotals(from: string, to: string): Promise<DailyTotalRow[]> {
  const { data, error } = await supabase().rpc('daily_totals', { from_date: from, to_date: to });
  if (error) fail(error, "Couldn't load your totals");
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    date: String(r.date),
    entries: Number(r.entries),
    values: toPer100(r),
    missing: (r.missing as Record<string, number>) ?? {},
    ai: (r.ai as Record<string, number>) ?? {},
  }));
}

export interface NewEntry {
  eaten_at: string;
  meal: Meal;
  food_id: string | null;
  food_name_snapshot: string;
  source_snapshot: string | null;
  grams: number;
  entered_amount: number;
  entered_unit: 'g' | 'ml' | 'measure';
  entered_measure?: string | null;
  per100_snapshot: Per100;
  ingredient_adjustments?: IngredientAdjustment | null;
  is_estimate?: boolean;
  method: LogMethod;
  meal_photo_id?: string | null;
}

const snapshot = (p: Per100) => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, p[k]]));

export async function logEntries(entries: NewEntry[]): Promise<LogEntry[]> {
  const { data, error } = await supabase()
    .from('log_entries')
    .insert(entries.map((e) => ({ ...e, per100_snapshot: snapshot(e.per100_snapshot) })))
    .select('*');
  if (error) fail(error, "Couldn't save");
  return (data ?? []).map(toEntry);
}

export async function updateEntry(id: string, patch: Partial<NewEntry>): Promise<LogEntry> {
  const body = patch.per100_snapshot ? { ...patch, per100_snapshot: snapshot(patch.per100_snapshot), hc_synced_at: null } : { ...patch, hc_synced_at: null };
  const { data, error } = await supabase().from('log_entries').update(body).eq('id', id).select('*').single();
  if (error) fail(error, "Couldn't save");
  return toEntry(data);
}

export async function deleteEntries(ids: string[]): Promise<void> {
  const { error } = await supabase().from('log_entries').delete().in('id', ids);
  if (error) fail(error, "Couldn't delete");
}

export async function markSynced(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabase().from('log_entries').update({ hc_synced_at: new Date().toISOString() }).in('id', ids);
}

/** Copy entries to another day and meal, keeping their snapshots and clock times. */
export async function copyEntries(entries: LogEntry[], toDate: string, meal: Meal, tz: string): Promise<LogEntry[]> {
  const { start } = dayBounds(tz, toDate);
  return logEntries(
    entries.map((e) => {
      const from = dayBounds(tz, new Date(e.eaten_at).toLocaleDateString('en-CA', { timeZone: tz })).start;
      const offset = new Date(e.eaten_at).getTime() - from.getTime();
      return {
        eaten_at: new Date(start.getTime() + offset).toISOString(),
        meal,
        food_id: e.food_id,
        food_name_snapshot: e.food_name_snapshot,
        source_snapshot: e.source_snapshot,
        grams: e.grams,
        entered_amount: e.entered_amount,
        entered_unit: e.entered_unit,
        entered_measure: e.entered_measure,
        per100_snapshot: e.per100_snapshot,
        ingredient_adjustments: e.ingredient_adjustments,
        is_estimate: e.is_estimate,
        method: 'repeat' as const,
      };
    }),
  );
}

// Foods ----------------------------------------------------------------------------------------

export interface SearchResult {
  id: string;
  source: Food['source'];
  visibility: Food['visibility'];
  created_by: string | null;
  name: string;
  display_name: string | null;
  brand: string | null;
  energy_kj: number | null;
  serving_g: number | null;
  total_weight_g: number | null;
  is_liquid: boolean;
  missing_nutrients: string[];
  use_count: number | null;
  last_grams: number | null;
  last_unit: 'g' | 'ml' | 'measure' | null;
  last_amount: number | null;
  last_measure: string | null;
  score: number | null;
  /** 1 = every word matched, 2 = some words, 3 = similar spelling only. */
  tier: 1 | 2 | 3 | null;
}

export async function searchFoods(q: string, limit = 30): Promise<SearchResult[]> {
  const { data, error } = await supabase().rpc('search_foods', { q, lim: limit });
  if (error) fail(error, "Search didn't work");
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    ...(r as unknown as SearchResult),
    energy_kj: num(r.energy_kj),
    serving_g: num(r.serving_g),
    total_weight_g: num(r.total_weight_g),
    last_grams: num(r.last_grams),
    last_amount: num(r.last_amount),
    score: num(r.score),
    tier: r.tier == null ? null : (Number(r.tier) as 1 | 2 | 3),
  }));
}

export async function getFood(id: string): Promise<Food> {
  const { data, error } = await supabase().from('foods').select('*').eq('id', id).single();
  if (error) fail(error, "Couldn't load that food");
  return toFood(data);
}

export async function getMeasures(foodId: string): Promise<Measure[]> {
  const { data, error } = await supabase().from('food_measures').select('*').eq('food_id', foodId).order('rank').order('created_at');
  if (error) fail(error, "Couldn't load measures");
  return (data ?? []).map((m) => ({ ...m, grams: Number(m.grams) }));
}

export async function getStats(foodId: string): Promise<FoodStats | null> {
  const { data } = await supabase().from('user_food_stats').select('*').eq('food_id', foodId).maybeSingle();
  return data ? { ...data, last_grams: num(data.last_grams), last_amount: num(data.last_amount) } : null;
}

export async function addMeasure(foodId: string, label: string, grams: number): Promise<Measure> {
  const uid = await userId();
  const { data, error } = await supabase()
    .from('food_measures')
    .insert({ food_id: foodId, label, grams, source: 'user', owner_id: uid, rank: 0 })
    .select('*')
    .single();
  if (error) fail(error, "Couldn't add the measure");
  return { ...data, grams: Number(data.grams) };
}

export async function deleteMeasure(id: string): Promise<void> {
  const { error } = await supabase().from('food_measures').delete().eq('id', id);
  if (error) fail(error, "Couldn't remove the measure");
}

export interface ListedFood {
  food: Food;
  stats: FoodStats | null;
}

const listed = (rows: Record<string, unknown>[] | null): ListedFood[] =>
  (rows ?? [])
    .filter((r) => r.food)
    .map((r) => ({
      food: toFood(r.food as Record<string, unknown>),
      stats: { ...(r as unknown as FoodStats), last_grams: num(r.last_grams), last_amount: num(r.last_amount) },
    }));

export async function recentFoods(limit = 12): Promise<ListedFood[]> {
  const { data, error } = await supabase()
    .from('user_food_stats')
    .select('*, food:foods(*)')
    .order('last_used_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, "Couldn't load recent foods");
  return listed(data);
}

export async function frequentFoods(limit = 12): Promise<ListedFood[]> {
  const { data, error } = await supabase()
    .from('user_food_stats')
    .select('*, food:foods(*)')
    .gte('use_count', 2)
    .order('use_count', { ascending: false })
    .order('last_used_at', { ascending: false })
    .limit(limit);
  if (error) fail(error, "Couldn't load frequent foods");
  return listed(data);
}

/** Your meals, most recently used first. */
export async function myMeals(): Promise<ListedFood[]> {
  const uid = await userId();
  const sb = supabase();
  const [{ data: meals, error }, { data: stats }] = await Promise.all([
    sb.from('foods').select('*').eq('source', 'meal').eq('created_by', uid).order('created_at', { ascending: false }),
    sb.from('user_food_stats').select('*, food:foods!inner(source)').eq('food.source', 'meal'),
  ]);
  if (error) fail(error, "Couldn't load your meals");
  const byId = new Map((stats ?? []).map((s) => [s.food_id as string, s as FoodStats]));
  return (meals ?? [])
    .map((m) => ({ food: toFood(m), stats: byId.get(m.id) ?? null }))
    .sort((a, b) => (b.stats?.last_used_at ?? b.food.created_at).localeCompare(a.stats?.last_used_at ?? a.food.created_at));
}

/** Editing a shared food, or one from FSANZ, makes your own copy. The shared row stays untouched. */
export async function savePrivateCopy(food: Food, patch: Partial<Food>): Promise<Food> {
  const uid = await userId();
  const own = food.visibility === 'private' && food.created_by === uid;
  const sb = supabase();
  const fields = {
    name: patch.name ?? food.name,
    display_name: patch.display_name ?? patch.name ?? food.display_name,
    brand: patch.brand ?? food.brand,
    barcode: food.barcode,
    serving_g: patch.serving_g !== undefined ? patch.serving_g : food.serving_g,
    pack_g: patch.pack_g !== undefined ? patch.pack_g : food.pack_g,
    is_liquid: patch.is_liquid ?? food.is_liquid,
    density_g_per_ml: food.density_g_per_ml,
    ...Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, patch[k] !== undefined ? patch[k] : food[k]])),
  };
  if (own) {
    const { data, error } = await sb.from('foods').update(fields).eq('id', food.id).select('*').single();
    if (error) fail(error, "Couldn't save");
    return toFood(data);
  }
  const { data, error } = await sb
    .from('foods')
    .insert({ ...fields, source: 'user', visibility: 'private', created_by: uid, derived_from_food_id: food.id })
    .select('*')
    .single();
  if (error) fail(error, "Couldn't save your copy");
  return toFood(data);
}

export async function createCustomFood(fields: Partial<Food> & { name: string }): Promise<Food> {
  const uid = await userId();
  const { data, error } = await supabase()
    .from('foods')
    .insert({ ...fields, source: 'user', visibility: 'private', created_by: uid })
    .select('*')
    .single();
  if (error) fail(error, "Couldn't save the food");
  return toFood(data);
}

/** Your own private copy of a barcode beats the shared catalogue. */
export async function myFoodByBarcode(barcode: string): Promise<Food | null> {
  const { data } = await supabase()
    .from('foods')
    .select('*')
    .eq('barcode', barcode)
    .eq('visibility', 'private')
    .order('updated_at', { ascending: false })
    .limit(1);
  return data?.[0] ? toFood(data[0]) : null;
}

export async function displayNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const { data } = await supabase().rpc('display_names', { ids });
  return Object.fromEntries(((data as { user_id: string; display_name: string }[]) ?? []).map((r) => [r.user_id, r.display_name]));
}

// Meals ----------------------------------------------------------------------------------------

export async function mealIngredients(mealId: string): Promise<MealIngredient[]> {
  const { data, error } = await supabase()
    .from('meal_ingredients')
    .select('*, food:foods!meal_ingredients_ingredient_food_id_fkey(*)')
    .eq('meal_food_id', mealId)
    .order('position');
  if (error) fail(error, "Couldn't load the recipe");
  return (data ?? []).map((r) => ({ ...r, grams: Number(r.grams), food: toFood(r.food) }));
}

export interface MealDraft {
  id?: string;
  name: string;
  serves: number | null;
  cooked_weight_g: number | null;
  ingredients: { food_id: string; grams: number }[];
}

/** Saves the meal row and replaces its recipe. The database recomputes per-100 g values. */
export async function saveMeal(m: MealDraft): Promise<Food> {
  const uid = await userId();
  const sb = supabase();
  let id = m.id;
  if (id) {
    const { error } = await sb.from('foods').update({ name: m.name, display_name: m.name, serves: m.serves, cooked_weight_g: m.cooked_weight_g }).eq('id', id);
    if (error) fail(error, "Couldn't save the meal");
    const { error: e2 } = await sb.from('meal_ingredients').delete().eq('meal_food_id', id);
    if (e2) fail(e2, "Couldn't save the meal");
  } else {
    const { data, error } = await sb
      .from('foods')
      .insert({ source: 'meal', visibility: 'private', created_by: uid, name: m.name, display_name: m.name, serves: m.serves, cooked_weight_g: m.cooked_weight_g })
      .select('id')
      .single();
    if (error) fail(error, "Couldn't save the meal");
    id = data.id as string;
  }
  if (m.ingredients.length) {
    const { error } = await sb
      .from('meal_ingredients')
      .insert(m.ingredients.map((i, position) => ({ meal_food_id: id, ingredient_food_id: i.food_id, grams: i.grams, position })));
    if (error) fail(error, "Couldn't save the ingredients");
  }
  return getFood(id!);
}

export async function deleteFood(id: string): Promise<void> {
  const { error } = await supabase().from('foods').delete().eq('id', id);
  if (error) {
    if (/foreign key/i.test(error.message)) throw new Error("It's an ingredient in one of your meals, so it can't be deleted.");
    fail(error, "Couldn't delete");
  }
}

export const yesterday = (date: string) => addDays(date, -1);
