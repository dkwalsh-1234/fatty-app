// Idempotent writes for the file importers. Foods upsert on (source, source_id) and measures on
// (source, source_key), so running an import again after a new FSANZ release updates rows rather than
// duplicating them. Rows that were in an earlier release but not this one are counted and left alone.
//
// display_name: a new food gets display_name = name. On re-import, a display_name someone has edited
// (it differs from the stored name) is kept; an unedited one follows FSANZ's new name.

import type { SupabaseClient } from '@supabase/supabase-js';
import { NUTRIENT_KEYS } from '../../lib/nutrients';
import type { FoodRow, FoodSource, MeasureRow } from '../../lib/sources/types';

export const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

export interface UpsertOptions {
  batchSize?: number;
  log?: (line: string) => void;
}

export interface UpsertSummary {
  foods: { total: number; inserted: number; updated: number; keptDisplayName: number; notInThisRelease: number };
  measures: { total: number; inserted: number; updated: number; skippedNoFood: number; notInThisRelease: number };
}

type Result<T> = { data: T | null; error: { message: string; code?: string; details?: string | null; hint?: string | null } | null };

function describeError(e: NonNullable<Result<unknown>['error']>): string {
  return [e.message, e.details, e.hint && `Hint: ${e.hint}`, e.code && `(code ${e.code})`].filter(Boolean).join(' ');
}

/** Runs a Supabase call, retrying network failures (no error code) a couple of times. */
async function run<T>(what: string, call: () => PromiseLike<Result<T> & { count?: number | null }>, attempts = 3) {
  for (let i = 1; ; i++) {
    const res = await call();
    if (!res.error) return { data: res.data as T, count: res.count ?? null };
    if (res.error.code || i >= attempts) {
      const tooBig = /413|too large|timeout|timed out|57014/i.test(describeError(res.error));
      throw new Error(
        `${what} failed: ${describeError(res.error)}${tooBig ? '\nTry a smaller batch, e.g. --batch-size 100.' : ''}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000 * i));
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every row of a source, page by page. Uses the exact count, so a server row limit below PAGE_SIZE can't cut it short. */
async function fetchAll<T>(client: SupabaseClient, table: string, columns: string, source: string): Promise<T[]> {
  const out: T[] = [];
  let total: number | null = null;
  for (let from = 0; ; ) {
    const { data, count } = await run<T[]>(`Reading existing ${table}`, () =>
      client
        .from(table)
        .select(columns, { count: 'exact' })
        .eq('source', source)
        .order('id')
        .range(from, from + PAGE_SIZE - 1) as unknown as PromiseLike<Result<T[]> & { count: number | null }>,
    );
    const page = data ?? [];
    total ??= count;
    out.push(...page);
    from += page.length;
    if (page.length === 0 || (total !== null ? out.length >= total : page.length < PAGE_SIZE)) return out;
  }
}

/** The columns an import writes. Leaving display_name out keeps an edited one on update. */
export function foodPayload(f: FoodRow, withDisplayName: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = {
    source: f.source,
    source_id: f.source_id,
    visibility: f.visibility,
    created_by: f.created_by ?? null,
    barcode: f.barcode ?? null,
    name: f.name,
    brand: f.brand ?? null,
    common_names: f.common_names ?? null,
    extra_nutrients: f.extra_nutrients ?? null,
    serving_g: f.serving_g ?? null,
    pack_g: f.pack_g ?? null,
    is_liquid: f.is_liquid ?? false,
    density_g_per_ml: f.density_g_per_ml ?? null,
    raw: f.raw ?? null,
  };
  for (const k of NUTRIENT_KEYS) p[k] = f[k];
  if (withDisplayName) p.display_name = f.display_name ?? f.name;
  return p;
}

function checkFoods(source: FoodSource, foods: FoodRow[]) {
  const seen = new Set<string>();
  for (const f of foods) {
    if (f.source !== source) throw new Error(`Food "${f.name}" has source ${f.source}, expected ${source}.`);
    if (!f.source_id) throw new Error(`Food "${f.name}" has no source_id; imports need one to upsert.`);
    if (seen.has(f.source_id)) throw new Error(`Duplicate source_id ${f.source_id} in this import.`);
    seen.add(f.source_id);
  }
}

export async function upsertFoods(
  client: SupabaseClient,
  source: FoodSource,
  foods: FoodRow[],
  opts: UpsertOptions = {},
): Promise<{ idBySourceId: Map<string, string>; summary: UpsertSummary['foods'] }> {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const log = opts.log ?? (() => {});
  checkFoods(source, foods);

  const existing = await fetchAll<{ id: string; source_id: string; name: string; display_name: string | null }>(
    client,
    'foods',
    'id, source_id, name, display_name',
    source,
  );
  const existingBySourceId = new Map(existing.map((r) => [r.source_id, r]));

  const withName: Record<string, unknown>[] = [];
  const keepName: Record<string, unknown>[] = [];
  for (const f of foods) {
    const ex = existingBySourceId.get(f.source_id!);
    const edited = !!ex && !!ex.display_name && ex.display_name !== ex.name;
    (edited ? keepName : withName).push(foodPayload(f, !edited));
  }

  const idBySourceId = new Map<string, string>();
  const batches = [...chunk(withName, batchSize), ...chunk(keepName, batchSize)];
  let done = 0;
  for (const [i, batch] of batches.entries()) {
    const { data: rows } = await run<{ id: string; source_id: string }[]>(`Upserting foods batch ${i + 1}/${batches.length}`, () =>
      client
        .from('foods')
        .upsert(batch, { onConflict: 'source,source_id' })
        .select('id, source_id') as unknown as PromiseLike<Result<{ id: string; source_id: string }[]>>,
    );
    for (const r of rows ?? []) idBySourceId.set(r.source_id, r.id);
    done += batch.length;
    log(`  foods ${done}/${foods.length}`);
  }

  const importIds = new Set(foods.map((f) => f.source_id!));
  const inserted = foods.filter((f) => !existingBySourceId.has(f.source_id!)).length;
  return {
    idBySourceId,
    summary: {
      total: foods.length,
      inserted,
      updated: foods.length - inserted,
      keptDisplayName: keepName.length,
      notInThisRelease: existing.filter((r) => !importIds.has(r.source_id)).length,
    },
  };
}

export async function upsertMeasures(
  client: SupabaseClient,
  measures: MeasureRow[],
  idBySourceId: Map<string, string>,
  opts: UpsertOptions = {},
): Promise<UpsertSummary['measures']> {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const log = opts.log ?? (() => {});
  const sources = [...new Set(measures.map((m) => m.source))];
  const existingKeys = new Set<string>();
  for (const s of sources) {
    for (const r of await fetchAll<{ source_key: string | null }>(client, 'food_measures', 'id, source_key', s)) {
      if (r.source_key) existingKeys.add(`${s}|${r.source_key}`);
    }
  }

  const seen = new Set<string>();
  const payload: Record<string, unknown>[] = [];
  let skippedNoFood = 0;
  for (const m of measures) {
    const foodId = idBySourceId.get(m.food_source_id);
    if (!foodId) {
      skippedNoFood++;
      continue;
    }
    const k = `${m.source}|${m.source_key}`;
    if (seen.has(k)) throw new Error(`Duplicate measure source_key ${m.source_key} in this import.`);
    seen.add(k);
    payload.push({
      food_id: foodId,
      label: m.label,
      grams: m.grams,
      source: m.source,
      owner_id: null,
      rank: m.rank,
      source_key: m.source_key,
    });
  }

  const batches = chunk(payload, batchSize);
  let done = 0;
  for (const [i, batch] of batches.entries()) {
    await run(`Upserting measures batch ${i + 1}/${batches.length}`, () =>
      client.from('food_measures').upsert(batch, { onConflict: 'source,source_key' }) as unknown as PromiseLike<
        Result<null>
      >,
    );
    done += batch.length;
    log(`  measures ${done}/${payload.length}`);
  }

  const inserted = [...seen].filter((k) => !existingKeys.has(k)).length;
  return {
    total: payload.length,
    inserted,
    updated: payload.length - inserted,
    skippedNoFood,
    notInThisRelease: [...existingKeys].filter((k) => !seen.has(k)).length,
  };
}

/** Foods first (to learn their ids), then their measures. */
export async function upsertImport(
  client: SupabaseClient,
  source: FoodSource,
  foods: FoodRow[],
  measures: MeasureRow[],
  opts: UpsertOptions = {},
): Promise<UpsertSummary> {
  const { idBySourceId, summary: foodSummary } = await upsertFoods(client, source, foods, opts);
  const measureSummary = measures.length
    ? await upsertMeasures(client, measures, idBySourceId, opts)
    : { total: 0, inserted: 0, updated: 0, skippedNoFood: 0, notInThisRelease: 0 };
  return { foods: foodSummary, measures: measureSummary };
}
