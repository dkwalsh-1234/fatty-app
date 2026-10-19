// Runs the real migrations against PGlite with the bits of Supabase they rely on
// (auth.users, auth.uid(), storage, roles) stubbed out.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  $$;
  grant usage on schema auth, extensions, public to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, service_role;
  grant select, insert, update, delete on storage.objects to authenticated, service_role;
`;

const DANIEL = "00000000-0000-4000-8000-000000000001";
const FRIEND = "00000000-0000-4000-8000-000000000002";

let db: PGlite;

async function as<T>(sub: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${sub}"}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role service_role;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const per100 = (o: Record<string, number | null>) => JSON.stringify(o);

beforeAll(async () => {
  db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_STUBS);
  const dir = join(__dirname, "../supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${DANIEL}', 'daniel@example.com');
    insert into auth.users (id, email) values ('${FRIEND}', 'sam.friend@example.com');
  `);
});

describe("profiles", () => {
  it("creates a profile for every invited user", async () => {
    const { rows } = await db.query<{ display_name: string }>("select display_name from public.profiles order by display_name");
    expect(rows.map((r) => r.display_name)).toEqual(["Daniel", "Sam.Friend"]);
  });

  it("only lets the service role grant admin", async () => {
    await as(FRIEND, () => db.exec(`update public.profiles set is_admin = true, display_name = 'Sam' where user_id = '${FRIEND}'`));
    const p = await one<{ is_admin: boolean; display_name: string }>(`select is_admin, display_name from public.profiles where user_id = '${FRIEND}'`);
    expect(p).toEqual({ is_admin: false, display_name: "Sam" });
    await asService(() => db.exec(`update public.profiles set is_admin = true where user_id = '${DANIEL}'`));
    expect((await one<{ is_admin: boolean }>(`select is_admin from public.profiles where user_id = '${DANIEL}'`)).is_admin).toBe(true);
  });

  it("hides other people's profiles but shares display names", async () => {
    const { rows } = await as(FRIEND, () => db.query("select * from public.profiles"));
    expect(rows).toHaveLength(1);
    const names = await as(FRIEND, () => db.query<{ display_name: string }>(`select display_name from public.display_names(array['${DANIEL}']::uuid[])`));
    expect(names.rows).toEqual([{ display_name: "Daniel" }]);
  });
});

describe("AI keys", () => {
  it("never lets the browser select a key, but shows provider and last four", async () => {
    await asService(() =>
      db.exec(`insert into public.ai_keys (owner_id, provider, key_encrypted, key_last4) values ('${DANIEL}', 'gemini', 'sealed', 'a1b2')`),
    );
    await expect(as(DANIEL, () => db.query("select * from public.ai_keys"))).rejects.toThrow(/permission denied/);
    const k = await as(DANIEL, () => one<Record<string, unknown>>("select * from public.my_ai_key()"));
    expect(k).toEqual({ provider: "gemini", key_last4: "a1b2", model: null, verified_at: null });
    const none = await as(FRIEND, () => db.query("select * from public.my_ai_key()"));
    expect(none.rows).toHaveLength(0);
  });
});

describe("foods and the shared catalogue", () => {
  it("computes missing nutrients and defaults the display name", async () => {
    const f = await asService(() =>
      one<{ missing_nutrients: string[]; display_name: string }>(
        `insert into public.foods (source, source_id, visibility, name, energy_kj, protein_g, fat_g, carbs_g, sugars_g, fibre_g, sodium_mg, trans_fat_g)
         values ('off', '9300000000001', 'shared', 'Untoasted fruit muesli', 1620, 10.2, 8.9, 58.4, 17.6, 9.1, 15, 0)
         returning missing_nutrients, display_name`,
      ),
    );
    expect(f.missing_nutrients).toEqual(["sat_fat_g"]);
    expect(f.display_name).toBe("Untoasted fruit muesli");
  });

  it("refuses shared rows from the browser and keeps private rows private", async () => {
    await expect(
      as(FRIEND, () =>
        db.exec(`insert into public.foods (source, visibility, created_by, name) values ('label', 'shared', '${FRIEND}', 'Sneaky')`),
      ),
    ).rejects.toThrow(/row-level security/);
    await as(FRIEND, () =>
      db.exec(`insert into public.foods (source, visibility, created_by, name, energy_kj) values ('user', 'private', '${FRIEND}', 'Sam''s granola', 1800)`),
    );
    const mine = await as(FRIEND, () => db.query("select name from public.foods where source = 'user'"));
    expect(mine.rows).toHaveLength(1);
    const theirs = await as(DANIEL, () => db.query("select name from public.foods where source = 'user'"));
    expect(theirs.rows).toHaveLength(0);
    const shared = await as(DANIEL, () => db.query("select name from public.foods where source = 'off'"));
    expect(shared.rows).toHaveLength(1);
  });

  it("keeps one shared row per barcode", async () => {
    await asService(() =>
      db.exec(`insert into public.foods (source, visibility, created_by, barcode, name, energy_kj) values ('label', 'shared', '${DANIEL}', '9310000000017', 'Choc bar', 2000)`),
    );
    await expect(
      asService(() =>
        db.exec(`insert into public.foods (source, visibility, created_by, barcode, name, energy_kj) values ('label', 'shared', '${FRIEND}', '9310000000017', 'Choc bar again', 2001)`),
      ),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("meals", () => {
  // The brief's acceptance check: six-ingredient pasta, cooked weight 1,200 g, 300 g logged = a quarter.
  const ingredients = [
    ["Spaghetti, dry", 500, { energy_kj: 1500, protein_g: 12.5, fat_g: 1.5, sat_fat_g: 0.3, trans_fat_g: 0, carbs_g: 71, sugars_g: 3, fibre_g: 3, sodium_mg: 5 }],
    ["Passata", 400, { energy_kj: 140, protein_g: 1.5, fat_g: 0.2, sat_fat_g: 0, trans_fat_g: 0, carbs_g: 5.5, sugars_g: 4.5, fibre_g: 1.2, sodium_mg: 180 }],
    ["Beef mince", 500, { energy_kj: 900, protein_g: 20, fat_g: 15, sat_fat_g: 6.5, trans_fat_g: 0.6, carbs_g: 0, sugars_g: 0, fibre_g: 0, sodium_mg: 70 }],
    ["Brown onion", 150, { energy_kj: 150, protein_g: 1.2, fat_g: 0.1, sat_fat_g: 0, trans_fat_g: 0, carbs_g: 6.5, sugars_g: 4.5, fibre_g: 1.8, sodium_mg: 4 }],
    ["Olive oil", 20, { energy_kj: 3700, protein_g: 0, fat_g: 100, sat_fat_g: 14, trans_fat_g: 0, carbs_g: 0, sugars_g: 0, fibre_g: 0, sodium_mg: 0 }],
    ["Parmesan", 60, { energy_kj: 1680, protein_g: 35, fat_g: 29, sat_fat_g: 18.5, trans_fat_g: 1, carbs_g: 0, sugars_g: 0, fibre_g: 0, sodium_mg: 1450 }],
  ] as const;
  let mealId = "";
  const ids: string[] = [];

  it("works out per-100 g from the ingredients and a typed cooked weight", async () => {
    await asService(async () => {
      for (const [name, , n] of ingredients) {
        const r = await one<{ id: string }>(
          `insert into public.foods (source, source_id, visibility, name, energy_kj, protein_g, fat_g, sat_fat_g, trans_fat_g, carbs_g, sugars_g, fibre_g, sodium_mg)
           values ('ausnut', $1, 'shared', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
          [name, n.energy_kj, n.protein_g, n.fat_g, n.sat_fat_g, n.trans_fat_g, n.carbs_g, n.sugars_g, n.fibre_g, n.sodium_mg],
        );
        ids.push(r.id);
      }
    });
    await as(DANIEL, async () => {
      mealId = (await one<{ id: string }>(
        `insert into public.foods (source, visibility, created_by, name, serves) values ('meal', 'private', '${DANIEL}', 'Tuesday pasta', 4) returning id`,
      )).id;
      for (let i = 0; i < ingredients.length; i++) {
        await db.query(`insert into public.meal_ingredients (meal_food_id, ingredient_food_id, grams, position) values ($1, $2, $3, $4)`, [mealId, ids[i], ingredients[i][1], i]);
      }
    });
    const sumWeight = ingredients.reduce((s, i) => s + i[1], 0);
    const total = ingredients.reduce((s, [, g, n]) => s + (n.energy_kj * g) / 100, 0);
    let m = await one<{ total_weight_g: string; energy_kj: string }>(`select total_weight_g, energy_kj from public.foods where id = $1`, [mealId]);
    expect(Number(m.total_weight_g)).toBe(sumWeight);
    expect(Number(m.energy_kj)).toBeCloseTo((total / sumWeight) * 100, 6);

    await as(DANIEL, () => db.query(`update public.foods set cooked_weight_g = 1200 where id = $1`, [mealId]));
    m = await one(`select total_weight_g, energy_kj from public.foods where id = $1`, [mealId]);
    expect(Number(m.total_weight_g)).toBe(1200);
    // 300 g of a 1,200 g dish is exactly a quarter of the recipe.
    expect((Number(m.energy_kj) * 300) / 100).toBeCloseTo(total / 4, 6);
  });

  it("inherits a gap from any ingredient", async () => {
    await asService(() => db.query(`update public.foods set sat_fat_g = null where id = $1`, [ids[5]]));
    // Shared foods don't fire the ingredient trigger for other people's meals unless recomputed; do it as the owner.
    await as(DANIEL, () => db.query(`update public.meal_ingredients set grams = 60 where meal_food_id = $1 and position = 5`, [mealId]));
    const m = await one<{ sat_fat_g: string | null; missing_nutrients: string[] }>(`select sat_fat_g, missing_nutrients from public.foods where id = $1`, [mealId]);
    expect(m.sat_fat_g).toBeNull();
    expect(m.missing_nutrients).toEqual(["sat_fat_g"]);
  });

  it("keeps recipes private", async () => {
    const r = await as(FRIEND, () => db.query(`select * from public.meal_ingredients where meal_food_id = $1`, [mealId]));
    expect(r.rows).toHaveLength(0);
    await expect(
      as(FRIEND, () => db.query(`insert into public.meal_ingredients (meal_food_id, ingredient_food_id, grams) values ($1, $2, 10)`, [mealId, ids[0]])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("log, stats and local days", () => {
  it("keeps an 11:30 pm entry on its own local day", async () => {
    // 19 Oct 2026, 11:30 pm in Sydney (AEDT, UTC+11) is 12:30 pm UTC the same day.
    await as(DANIEL, async () => {
      await db.query(
        `insert into public.log_entries (eaten_at, meal, food_name_snapshot, grams, entered_amount, per100_snapshot, method)
         values ('2026-10-19T12:30:00Z', 'snack', 'Almonds', 30, 30, $1, 'search'),
                ('2026-10-19T13:30:00Z', 'snack', 'Late toast', 50, 50, $2, 'search')`,
        [
          per100({ energy_kj: 2500, protein_g: 20, fat_g: 50, sat_fat_g: 4, trans_fat_g: 0, carbs_g: 5, sugars_g: 4, fibre_g: 9, sodium_mg: 1 }),
          per100({ energy_kj: 1000, protein_g: 9, fat_g: 3, sat_fat_g: null, trans_fat_g: null, carbs_g: 45, sugars_g: 3, fibre_g: 6, sodium_mg: 450 }),
        ],
      );
    });
    const d19 = await as(DANIEL, () => db.query<{ food_name_snapshot: string }>(`select food_name_snapshot from public.day_entries('2026-10-19')`));
    expect(d19.rows.map((r) => r.food_name_snapshot)).toEqual(["Almonds"]);
    const d20 = await as(DANIEL, () => db.query<{ food_name_snapshot: string }>(`select food_name_snapshot from public.day_entries('2026-10-20')`));
    expect(d20.rows.map((r) => r.food_name_snapshot)).toEqual(["Late toast"]);
  });

  it("totals a day exactly and counts missing values", async () => {
    const t = await as(DANIEL, () =>
      db.query<{ date: string; energy_kj: string; sat_fat_g: string | null; missing: Record<string, number> }>(
        `select * from public.daily_totals('2026-10-19', '2026-10-20')`,
      ),
    );
    expect(t.rows).toHaveLength(2);
    expect(Number(t.rows[0].energy_kj)).toBe(750);
    expect(t.rows[1].sat_fat_g).toBeNull();
    expect(t.rows[1].missing.sat_fat_g).toBe(1);
  });

  it("hides one person's log from another", async () => {
    const r = await as(FRIEND, () => db.query(`select * from public.log_entries`));
    expect(r.rows).toHaveLength(0);
  });

  it("tracks Recent and Frequent per person", async () => {
    const food = await one<{ id: string }>(`select id from public.foods where name = 'Passata'`);
    await as(DANIEL, async () => {
      for (const g of [100, 120]) {
        await db.query(
          `insert into public.log_entries (meal, food_id, food_name_snapshot, grams, entered_amount, per100_snapshot, method) values ('dinner', $1, 'Passata', $2, $2, '{}', 'search')`,
          [food.id, g],
        );
      }
    });
    const s = await as(DANIEL, () => one<{ use_count: number; last_grams: string }>(`select use_count, last_grams from public.user_food_stats where food_id = $1`, [food.id]));
    expect(s.use_count).toBe(2);
    expect(Number(s.last_grams)).toBe(120);
    const other = await as(FRIEND, () => db.query(`select * from public.user_food_stats`));
    expect(other.rows).toHaveLength(0);
  });
});

describe("search", () => {
  beforeAll(async () => {
    await asService(() =>
      db.exec(`
        insert into public.foods (source, source_id, visibility, name, energy_kj) values
          ('afcd', 'F1', 'shared', 'Broccoli, raw', 120),
          ('ausnut', 'A1', 'shared', 'Broccoli, boiled, no added fat', 130),
          ('ausnut', 'A2', 'shared', 'Mixed salad leaves', 70),
          ('afcd', 'F2', 'shared', 'Salad, garden', 80),
          ('ausnut', 'A3', 'shared', 'Banana, cavendish, peeled, raw', 380),
          ('afcd', 'F4', 'shared', 'Pumpkin, raw', 90),
          ('ausnut', 'A4', 'shared', 'Pumpkin, raw', 92);
      `),
    );
  });

  it("tolerates typos", async () => {
    const r = await as(DANIEL, () => db.query<{ name: string }>(`select name from public.search_foods('brocoli')`));
    expect(r.rows.map((x) => x.name)).toContain("Broccoli, raw");
  });

  it("matches as you type", async () => {
    const r = await as(DANIEL, () => db.query<{ name: string }>(`select name from public.search_foods('ban')`));
    expect(r.rows[0].name).toBe("Banana, cavendish, peeled, raw");
  });

  it("puts foods you've logged first", async () => {
    const garden = await one<{ id: string }>(`select id from public.foods where name = 'Salad, garden'`);
    await as(FRIEND, () =>
      db.query(
        `insert into public.log_entries (meal, food_id, food_name_snapshot, grams, entered_amount, per100_snapshot, method) values ('lunch', $1, 'Salad, garden', 45, 45, '{}', 'search')`,
        [garden.id],
      ),
    );
    const friend = await as(FRIEND, () => db.query<{ name: string; last_grams: string }>(`select name, last_grams from public.search_foods('salad')`));
    expect(friend.rows[0].name).toBe("Salad, garden");
    expect(Number(friend.rows[0].last_grams)).toBe(45);
    const daniel = await as(DANIEL, () => db.query<{ name: string }>(`select name from public.search_foods('salad')`));
    // Daniel hasn't logged it, so match quality decides: a name starting with the query wins.
    expect(daniel.rows[0].name).toBe("Salad, garden");
  });

  it("breaks ties on source: AUSNUT before AFCD", async () => {
    const r = await as(DANIEL, () => db.query<{ source: string }>(`select source from public.search_foods('pumpkin')`));
    expect(r.rows.map((x) => x.source)).toEqual(["ausnut", "afcd"]);
  });

  it("never shows someone else's private foods", async () => {
    const r = await as(DANIEL, () => db.query<{ name: string }>(`select name from public.search_foods('granola')`));
    expect(r.rows).toHaveLength(0);
  });
});

describe("storage", () => {
  it("keeps meal photos private and label photos shared", async () => {
    await asService(() =>
      db.exec(`
        insert into storage.objects (bucket_id, name) values
          ('meal-photos', '${DANIEL}/meal/1.jpg'),
          ('label-photos', '${DANIEL}/label/1.jpg');
      `),
    );
    const friend = await as(FRIEND, () => db.query<{ bucket_id: string }>(`select bucket_id from storage.objects`));
    expect(friend.rows.map((r) => r.bucket_id)).toEqual(["label-photos"]);
    await expect(
      as(FRIEND, () => db.exec(`insert into storage.objects (bucket_id, name) values ('label-photos', '${DANIEL}/label/2.jpg')`)),
    ).rejects.toThrow(/row-level security/);
  });
});
