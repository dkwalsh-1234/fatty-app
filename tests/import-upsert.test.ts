// The import upsert against an in-memory stand-in for the Supabase client: batching, idempotent
// re-runs, food_id resolution for measures, and keeping an edited display_name.
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAusnut, type AusnutLoadResult } from '../lib/sources/ausnut';
import type { FoodRow } from '../lib/sources/types';
import { upsertImport } from '../scripts/lib/upsert';
import { tempDir, writeAusnutFixtures } from './fixtures/fsanz';

type DbRow = Record<string, unknown>;

/** Just enough of supabase-js's query builder for scripts/lib/upsert.ts. */
class FakeDb {
  tables: Record<string, DbRow[]> = { foods: [], food_measures: [] };
  upsertCalls: { table: string; rows: number; onConflict: string }[] = [];
  maxRows = 3;
  private nextId = 1;

  client(): SupabaseClient {
    return { from: (table: string) => new FakeQuery(this, table) } as unknown as SupabaseClient;
  }

  newId() {
    return `id-${this.nextId++}`;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private op: 'select' | 'upsert' = 'select';
  private filters: [string, unknown][] = [];
  private from = 0;
  private to = Infinity;
  private rows: DbRow[] = [];
  private onConflict = '';
  private returning: string | null = null;

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  private counted = false;

  select(columns: string, opts?: { count?: 'exact' }) {
    if (this.op === 'upsert') this.returning = columns;
    this.counted = opts?.count === 'exact';
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  order() {
    return this;
  }
  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }
  upsert(rows: DbRow[], opts: { onConflict: string }) {
    this.op = 'upsert';
    this.rows = rows;
    this.onConflict = opts.onConflict;
    return this;
  }

  private run(): { data: unknown; error: null; count?: number } {
    const table = this.db.tables[this.table];
    if (this.op === 'select') {
      const hits = table.filter((r) => this.filters.every(([c, v]) => r[c] === v));
      // Like a Supabase project whose max rows setting is 3: pages come back shorter than asked for.
      const end = Math.min(this.to + 1, this.from + this.db.maxRows);
      return { data: hits.slice(this.from, end), error: null, ...(this.counted ? { count: hits.length } : {}) };
    }
    this.db.upsertCalls.push({ table: this.table, rows: this.rows.length, onConflict: this.onConflict });
    const cols = this.onConflict.split(',');
    const out: DbRow[] = [];
    for (const row of this.rows) {
      let hit = table.find((r) => cols.every((c) => r[c] === row[c]));
      if (hit) Object.assign(hit, row);
      else {
        hit = { id: this.db.newId(), display_name: null, ...row };
        if (this.table === 'foods' && !hit.display_name) hit.display_name = hit.name; // the DB trigger
        table.push(hit);
      }
      out.push(hit);
    }
    return { data: this.returning ? out.map((r) => ({ id: r.id, source_id: r.source_id })) : null, error: null };
  }

  then<A, B>(
    onFulfilled?: (v: { data: unknown; error: null; count?: number }) => A | PromiseLike<A>,
    onRejected?: (e: unknown) => B | PromiseLike<B>,
  ) {
    return Promise.resolve()
      .then(() => this.run())
      .then(onFulfilled, onRejected);
  }
}

let root: string;
let loaded: AusnutLoadResult;

beforeAll(async () => {
  root = await tempDir('upsert');
  loaded = await loadAusnut(await writeAusnutFixtures(join(root, 'raw')));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('import upsert', () => {
  it('writes foods in batches, then measures with the food ids', async () => {
    const db = new FakeDb();
    const summary = await upsertImport(db.client(), 'ausnut', loaded.foods, loaded.measures, { batchSize: 2 });
    expect(summary.foods).toMatchObject({ total: 5, inserted: 5, updated: 0, notInThisRelease: 0 });
    expect(summary.measures).toMatchObject({ total: 7, inserted: 7, updated: 0, skippedNoFood: 0 });
    expect(db.upsertCalls.filter((c) => c.table === 'foods').map((c) => c.rows)).toEqual([2, 2, 1]);
    expect(db.upsertCalls.every((c) => c.onConflict === (c.table === 'foods' ? 'source,source_id' : 'source,source_key'))).toBe(true);

    const milk = db.tables.foods.find((f) => f.source_id === 'F900001')!;
    expect(milk).toMatchObject({ source: 'ausnut', visibility: 'shared', created_by: null, trans_fat_g: 0.12, is_liquid: true });
    const milkMeasures = db.tables.food_measures.filter((m) => m.food_id === milk.id);
    expect(milkMeasures.map((m) => [m.label, m.grams, m.rank, m.source_key, m.owner_id])).toEqual([
      ['1 cup (250 mL)', 258, 0, 'F900001#44002', null],
      ['1 glass, large (350 mL)', 361, 1, 'F900001#44003', null],
    ]);
  });

  it('updates rather than duplicates on a second run, and keeps an edited display name', async () => {
    const db = new FakeDb();
    await upsertImport(db.client(), 'ausnut', loaded.foods, loaded.measures);
    // Someone shortens the banana's display name; FSANZ renames the bread in the next release.
    db.tables.foods.find((f) => f.source_id === 'F900002')!.display_name = 'Banana';
    const next: FoodRow[] = loaded.foods.map((f) =>
      f.source_id === 'F900003' ? { ...f, name: 'Bread, white, sliced', display_name: 'Bread, white, sliced' } : f,
    );
    const nextRelease = next.filter((f) => f.source_id !== 'F900006');

    const summary = await upsertImport(db.client(), 'ausnut', nextRelease, loaded.measures);
    expect(db.tables.foods).toHaveLength(5);
    expect(db.tables.food_measures).toHaveLength(7);
    expect(summary.foods).toMatchObject({ total: 4, inserted: 0, updated: 4, keptDisplayName: 1, notInThisRelease: 1 });
    expect(summary.measures).toMatchObject({ total: 7, inserted: 0, updated: 7 });

    const byKey = (k: string) => db.tables.foods.find((f) => f.source_id === k)!;
    expect(byKey('F900002').display_name).toBe('Banana');
    expect(byKey('F900003')).toMatchObject({ name: 'Bread, white, sliced', display_name: 'Bread, white, sliced' });
  });

  it('refuses duplicate source ids', async () => {
    const db = new FakeDb();
    const dup = [loaded.foods[0], { ...loaded.foods[0] }];
    await expect(upsertImport(db.client(), 'ausnut', dup, [])).rejects.toThrow(/Duplicate source_id F900001/);
  });
});
