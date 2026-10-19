-- Fatty: initial schema.
-- Nutrients are per 100 g in fixed columns; null means unknown, never zero.
-- Every user-owned table has row-level security. Shared catalogue rows are written only by
-- server routes (service role) and by the import scripts.

create extension if not exists pg_trgm with schema extensions;

-- Helpers -----------------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- People ------------------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  birth_date date,
  sex text check (sex in ('female', 'male')),
  height_cm numeric check (height_cm > 0 and height_cm < 300),
  activity_level text check (activity_level in ('sitting', 'some', 'active', 'very_active')),
  energy_target_override_kcal numeric check (energy_target_override_kcal > 0),
  warn_rate_pct_per_week numeric not null default 1 check (warn_rate_pct_per_week > 0),
  warn_floor_kcal numeric check (warn_floor_kcal > 0),           -- null = the sex-based default
  time_zone text not null default 'Australia/Sydney',
  energy_unit text not null default 'kcal' check (energy_unit in ('kcal', 'kj')),
  meal_boundaries jsonb,                                          -- null = app defaults
  widget_nutrients text[] not null default '{protein,sat_fat,sodium}',
  stable_mode boolean not null default false,
  burn_source text,                                               -- preferred Health Connect app; null = highest total
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Only the service role can grant admin. Anyone else's write keeps the old value.
create function public.guard_is_admin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    new.is_admin := coalesce(case when tg_op = 'UPDATE' then old.is_admin end, false);
  end if;
  return new;
end $$;

create trigger profiles_guard_admin before insert or update on public.profiles
  for each row execute function public.guard_is_admin();

-- A profile row for every invited user, created when Supabase creates the auth user.
create function public.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, initcap(split_part(coalesce(new.email, ''), '@', 1)))
  on conflict do nothing;
  return new;
end $$;
revoke execute on function public.create_profile() from public;

create trigger fatty_create_profile after insert on auth.users
  for each row execute function public.create_profile();

insert into public.profiles (user_id, display_name)
select id, initcap(split_part(coalesce(email, ''), '@', 1)) from auth.users
on conflict do nothing;

-- Display names of other people, for "added by" lines. Nothing else about them is readable.
create function public.display_names(ids uuid[]) returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.display_name from public.profiles p where p.user_id = any (ids)
$$;
revoke execute on function public.display_names(uuid[]) from public, anon;
grant execute on function public.display_names(uuid[]) to authenticated;

-- Goals, weigh-ins, burn ----------------------------------------------------------------------

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  start_weight_kg numeric not null check (start_weight_kg > 0),
  start_date date not null,
  target_weight_kg numeric not null check (target_weight_kg > 0),
  target_date date not null,
  active boolean not null default true,
  warnings_dismissed text[] not null default '{}',   -- warnings the person chose to continue past
  created_at timestamptz not null default now()
);
create unique index goals_one_active on public.goals (owner_id) where active;

create table public.weigh_ins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_at timestamptz not null default now(),
  weight_kg numeric not null check (weight_kg > 0 and weight_kg < 700),
  source text not null default 'manual'
);
create index weigh_ins_owner_time on public.weigh_ins (owner_id, measured_at desc);

-- Calories burned per local day and source app, read from Health Connect by the wrapper.
-- Sources are never added together; the app picks one per day.
create table public.daily_burn (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  source_app text not null default 'health_connect',
  total_kcal numeric check (total_kcal >= 0),
  active_kcal numeric check (active_kcal >= 0),
  fetched_at timestamptz not null default now(),
  primary key (owner_id, date, source_app)
);

-- Absent row = no target. min = at least (low), max = no more than (high), range = both.
create table public.nutrient_targets (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nutrient text not null check (nutrient in ('energy','protein','fat','sat_fat','trans_fat','carbs','sugars','fibre','sodium')),
  direction text not null check (direction in ('min', 'max', 'range')),
  low numeric check (low >= 0),
  high numeric check (high >= 0),
  primary key (owner_id, nutrient),
  check (
    (direction = 'min' and low is not null) or
    (direction = 'max' and high is not null) or
    (direction = 'range' and low is not null and high is not null and low <= high)
  )
);

-- Each person's own AI key, sealed with AES-256-GCM by the server. No policies: the browser
-- can never select it. Server routes read it with the service role; my_ai_key() shows the rest.
create table public.ai_keys (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'gemini', 'deepseek')),
  key_encrypted text not null,
  key_last4 text not null,
  model text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create function public.my_ai_key() returns table (provider text, key_last4 text, model text, verified_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.provider, k.key_last4, k.model, k.verified_at from public.ai_keys k where k.owner_id = auth.uid()
$$;
revoke execute on function public.my_ai_key() from public, anon;
grant execute on function public.my_ai_key() to authenticated;

-- Foods --------------------------------------------------------------------------------------

-- One row per food or meal from any source. Nutrients are per 100 g; null = unknown.
create table public.foods (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('user', 'label', 'meal', 'fsanz_branded', 'off', 'ausnut', 'afcd')),
  source_id text,                         -- FSANZ key, Open Food Facts code, ...; unique with source
  visibility text not null check (visibility in ('shared', 'private')),
  created_by uuid references auth.users (id) on delete set null,
  barcode text check (barcode ~ '^[0-9]{8,14}$'),
  name text not null,
  display_name text,
  brand text,
  common_names text,
  energy_kj numeric check (energy_kj >= 0),
  protein_g numeric check (protein_g >= 0),
  fat_g numeric check (fat_g >= 0),
  sat_fat_g numeric check (sat_fat_g >= 0),
  trans_fat_g numeric check (trans_fat_g >= 0),
  carbs_g numeric check (carbs_g >= 0),
  sugars_g numeric check (sugars_g >= 0),
  fibre_g numeric check (fibre_g >= 0),
  sodium_mg numeric check (sodium_mg >= 0),
  extra_nutrients jsonb,                  -- everything else FSANZ provides; not shown in v1
  serving_g numeric check (serving_g > 0),
  pack_g numeric check (pack_g > 0),
  total_weight_g numeric,                 -- meals: cooked weight if typed, else the sum of ingredients
  cooked_weight_g numeric check (cooked_weight_g > 0),
  serves numeric check (serves > 0),
  is_liquid boolean not null default false,
  density_g_per_ml numeric check (density_g_per_ml > 0),
  missing_nutrients text[] not null default '{}',
  derived_from_food_id uuid references public.foods (id) on delete set null,
  raw jsonb,                              -- original source payload
  search tsvector generated always as (
    to_tsvector('english'::regconfig,
      coalesce(display_name, '') || ' ' || coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(common_names, ''))
  ) stored,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source not in ('label', 'off', 'fsanz_branded', 'ausnut', 'afcd') or visibility = 'shared'),
  check (source not in ('user', 'meal') or visibility = 'private'),
  -- Importers upsert on this, so re-running after a new release updates rather than duplicates.
  constraint foods_source_source_id unique (source, source_id)
);

-- The shared catalogue keeps one row per barcode: the first person to add a product wins.
create unique index foods_shared_barcode on public.foods (barcode)
  where barcode is not null and visibility = 'shared' and source in ('label', 'off');
create unique index foods_fsanz_barcode on public.foods (barcode) where barcode is not null and source = 'fsanz_branded';
create index foods_private_barcode on public.foods (created_by, barcode) where barcode is not null and visibility = 'private';
create index foods_created_by on public.foods (created_by) where created_by is not null;
create index foods_search on public.foods using gin (search);
create index foods_name_trgm on public.foods using gin (
  (lower(coalesce(display_name, name) || ' ' || coalesce(brand, ''))) extensions.gin_trgm_ops
);

create trigger foods_touch before update on public.foods
  for each row execute function public.touch_updated_at();

-- missing_nutrients is computed on every write. For meals the nulls come from their ingredients.
create function public.foods_compute_missing() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.display_name is null or new.display_name = '' then new.display_name := new.name; end if;
  new.missing_nutrients := array_remove(array[
    case when new.energy_kj is null then 'energy_kj' end,
    case when new.protein_g is null then 'protein_g' end,
    case when new.fat_g is null then 'fat_g' end,
    case when new.sat_fat_g is null then 'sat_fat_g' end,
    case when new.trans_fat_g is null then 'trans_fat_g' end,
    case when new.carbs_g is null then 'carbs_g' end,
    case when new.sugars_g is null then 'sugars_g' end,
    case when new.fibre_g is null then 'fibre_g' end,
    case when new.sodium_mg is null then 'sodium_mg' end
  ], null);
  return new;
end $$;

create trigger foods_missing before insert or update on public.foods
  for each row execute function public.foods_compute_missing();

-- A meal's recipe. Per-100 g values on the meal row are recomputed whenever this changes.
create table public.meal_ingredients (
  id uuid primary key default gen_random_uuid(),
  meal_food_id uuid not null references public.foods (id) on delete cascade,
  ingredient_food_id uuid not null references public.foods (id) on delete restrict,
  grams numeric not null check (grams > 0),
  position int not null default 0,
  check (meal_food_id <> ingredient_food_id)
);
create index meal_ingredients_meal on public.meal_ingredients (meal_food_id, position);
create index meal_ingredients_ingredient on public.meal_ingredients (ingredient_food_id);

-- Per-100 g profile of a meal from its ingredients and total weight.
-- A nutrient missing from any ingredient is missing from the meal.
create function public.recompute_meal(p_meal uuid) returns void
language plpgsql set search_path = '' as $$
declare
  r record;
  v_cooked numeric;
  v_total numeric;
begin
  select cooked_weight_g into v_cooked from public.foods where id = p_meal and source = 'meal';
  if not found then return; end if;
  select
    coalesce(sum(mi.grams), 0) as grams,
    count(*) as n,
    sum(f.energy_kj * mi.grams) as energy_kj, bool_or(f.energy_kj is null) as m_energy,
    sum(f.protein_g * mi.grams) as protein_g, bool_or(f.protein_g is null) as m_protein,
    sum(f.fat_g * mi.grams) as fat_g, bool_or(f.fat_g is null) as m_fat,
    sum(f.sat_fat_g * mi.grams) as sat_fat_g, bool_or(f.sat_fat_g is null) as m_sat,
    sum(f.trans_fat_g * mi.grams) as trans_fat_g, bool_or(f.trans_fat_g is null) as m_trans,
    sum(f.carbs_g * mi.grams) as carbs_g, bool_or(f.carbs_g is null) as m_carbs,
    sum(f.sugars_g * mi.grams) as sugars_g, bool_or(f.sugars_g is null) as m_sugars,
    sum(f.fibre_g * mi.grams) as fibre_g, bool_or(f.fibre_g is null) as m_fibre,
    sum(f.sodium_mg * mi.grams) as sodium_mg, bool_or(f.sodium_mg is null) as m_sodium
  into r
  from public.meal_ingredients mi
  join public.foods f on f.id = mi.ingredient_food_id
  where mi.meal_food_id = p_meal;

  v_total := coalesce(v_cooked, r.grams);
  -- Sums are of (per-100 g × grams), so per 100 g of the meal = sum / total weight.
  update public.foods set
    total_weight_g = nullif(v_total, 0),
    energy_kj   = case when r.n = 0 or r.m_energy  or v_total = 0 then null else r.energy_kj   / v_total end,
    protein_g   = case when r.n = 0 or r.m_protein or v_total = 0 then null else r.protein_g   / v_total end,
    fat_g       = case when r.n = 0 or r.m_fat     or v_total = 0 then null else r.fat_g       / v_total end,
    sat_fat_g   = case when r.n = 0 or r.m_sat     or v_total = 0 then null else r.sat_fat_g   / v_total end,
    trans_fat_g = case when r.n = 0 or r.m_trans   or v_total = 0 then null else r.trans_fat_g / v_total end,
    carbs_g     = case when r.n = 0 or r.m_carbs   or v_total = 0 then null else r.carbs_g     / v_total end,
    sugars_g    = case when r.n = 0 or r.m_sugars  or v_total = 0 then null else r.sugars_g    / v_total end,
    fibre_g     = case when r.n = 0 or r.m_fibre   or v_total = 0 then null else r.fibre_g     / v_total end,
    sodium_mg   = case when r.n = 0 or r.m_sodium  or v_total = 0 then null else r.sodium_mg   / v_total end
  where id = p_meal;
end $$;

create function public.meal_ingredients_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public.recompute_meal(new.meal_food_id); end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.meal_food_id <> old.meal_food_id) then
    perform public.recompute_meal(old.meal_food_id);
  end if;
  return null;
end $$;

create trigger meal_ingredients_recompute after insert or update or delete on public.meal_ingredients
  for each row execute function public.meal_ingredients_changed();

-- A typed cooked weight changes the per-100 g profile.
create function public.meal_weight_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform public.recompute_meal(new.id);
  return null;
end $$;

create trigger foods_meal_weight after update of cooked_weight_g on public.foods
  for each row when (new.source = 'meal' and new.cooked_weight_g is distinct from old.cooked_weight_g)
  execute function public.meal_weight_changed();

-- Editing one of your own foods updates your meals that use it. Past log entries keep their snapshot.
create function public.ingredient_food_changed() returns trigger
language plpgsql set search_path = '' as $$
declare m uuid;
begin
  for m in select distinct meal_food_id from public.meal_ingredients where ingredient_food_id = new.id loop
    perform public.recompute_meal(m);
  end loop;
  return null;
end $$;

create trigger foods_ingredient_changed after update of
  energy_kj, protein_g, fat_g, sat_fat_g, trans_fat_g, carbs_g, sugars_g, fibre_g, sodium_mg on public.foods
  for each row when (new.source <> 'meal') execute function public.ingredient_food_changed();

-- Household measures: AUSNUT measures, pack serves, and your own ("my bowl · 320 g").
create table public.food_measures (
  id uuid primary key default gen_random_uuid(),
  food_id uuid not null references public.foods (id) on delete cascade,
  label text not null,
  grams numeric not null check (grams > 0),
  source text not null check (source in ('ausnut', 'afcd', 'pack', 'user', 'off')),
  owner_id uuid references auth.users (id) on delete cascade,   -- null = shared
  rank int not null default 100,                                -- lower first ("most used")
  source_key text,                                              -- importer id, for idempotent upserts
  created_at timestamptz not null default now(),
  constraint food_measures_source_key unique (source, source_key)
);
create index food_measures_food on public.food_measures (food_id, rank);

-- Photos ---------------------------------------------------------------------------------------

create table public.meal_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  storage_path text not null,
  hint text,
  provider text,
  model text,
  ai_response jsonb,      -- the validated AI output plus matched candidates; never re-sent to AI
  created_at timestamptz not null default now()
);

create table public.label_photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_id uuid references public.foods (id) on delete set null,
  storage_path text not null,
  front_storage_path text,
  barcode text,
  provider text,
  model text,
  ai_response jsonb,
  created_at timestamptz not null default now()
);
create index label_photos_food on public.label_photos (food_id);

-- Typed or dictated meals already parsed by AI, so the same text is never sent twice.
create table public.text_parses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  input_hash text not null,
  input text not null,
  provider text,
  model text,
  ai_response jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, input_hash)
);

-- Open Food Facts lookups. All users share one server address, so one rate limit (15 a minute).
create table public.off_lookups (
  id bigint generated always as identity primary key,
  barcode text not null,
  status text not null check (status in ('hit', 'miss', 'no_energy', 'error', 'rate_limited')),
  at timestamptz not null default now()
);
create index off_lookups_barcode on public.off_lookups (barcode, at desc);
create index off_lookups_at on public.off_lookups (at desc);

-- Log ------------------------------------------------------------------------------------------

-- What you ate. Nutrient values are a snapshot at log time, so later edits never rewrite history.
create table public.log_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  eaten_at timestamptz not null default now(),
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_id uuid references public.foods (id) on delete set null,
  food_name_snapshot text not null,
  source_snapshot text,
  grams numeric not null check (grams > 0),
  entered_amount numeric not null check (entered_amount > 0),
  entered_unit text not null default 'g' check (entered_unit in ('g', 'ml')),
  per100_snapshot jsonb not null,          -- the nine nutrients per 100 g at log time; null = unknown
  ingredient_adjustments jsonb,            -- a meal logged with changed ingredients, this log only
  is_estimate boolean not null default false,
  method text not null check (method in ('search', 'barcode', 'label', 'photo', 'text', 'meal', 'repeat')),
  meal_photo_id uuid references public.meal_photos (id) on delete set null,
  hc_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index log_entries_owner_time on public.log_entries (owner_id, eaten_at);

create trigger log_entries_touch before update on public.log_entries
  for each row execute function public.touch_updated_at();

-- Per person. Drives Recent and Frequent and the "last amount" chip over the shared catalogue.
create table public.user_food_stats (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  food_id uuid not null references public.foods (id) on delete cascade,
  use_count int not null default 0,
  last_used_at timestamptz,
  last_grams numeric,
  last_unit text check (last_unit in ('g', 'ml')),
  last_amount numeric,                     -- what was typed, in last_unit
  primary key (owner_id, food_id)
);
create index user_food_stats_recent on public.user_food_stats (owner_id, last_used_at desc);
create index user_food_stats_frequent on public.user_food_stats (owner_id, use_count desc);

create function public.log_entries_stats() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.food_id is null then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.user_food_stats as s (owner_id, food_id, use_count, last_used_at, last_grams, last_unit, last_amount)
    values (new.owner_id, new.food_id, 1, now(), new.grams, new.entered_unit, new.entered_amount)
    on conflict (owner_id, food_id) do update set
      use_count = s.use_count + 1,
      last_used_at = now(),
      last_grams = excluded.last_grams,
      last_unit = excluded.last_unit,
      last_amount = excluded.last_amount;
  elsif new.grams is distinct from old.grams or new.entered_unit is distinct from old.entered_unit then
    update public.user_food_stats set last_grams = new.grams, last_unit = new.entered_unit, last_amount = new.entered_amount
    where owner_id = new.owner_id and food_id = new.food_id;
  end if;
  return null;
end $$;

create trigger log_entries_update_stats after insert or update on public.log_entries
  for each row execute function public.log_entries_stats();

-- Day totals by local date, in each person's own time zone. 11:30 pm stays on that day.
create function public.my_time_zone() returns text
language sql stable set search_path = '' as $$
  select coalesce((select time_zone from public.profiles where user_id = auth.uid()), 'Australia/Sydney')
$$;

create function public.day_entries(d date) returns setof public.log_entries
language sql stable set search_path = '' as $$
  select e.* from public.log_entries e
  where e.owner_id = auth.uid()
    and e.eaten_at >= (d::timestamp at time zone public.my_time_zone())
    and e.eaten_at < ((d + 1)::timestamp at time zone public.my_time_zone())
  order by e.eaten_at, e.created_at
$$;

-- Totals per local day: the sum of known values, and how many entries were missing each nutrient.
create function public.daily_totals(from_date date, to_date date)
returns table (
  date date, entries int,
  energy_kj numeric, protein_g numeric, fat_g numeric, sat_fat_g numeric, trans_fat_g numeric,
  carbs_g numeric, sugars_g numeric, fibre_g numeric, sodium_mg numeric,
  missing jsonb
)
language sql stable set search_path = '' as $$
  with e as (
    select (x.eaten_at at time zone public.my_time_zone())::date as d, x.grams, x.per100_snapshot as p
    from public.log_entries x
    where x.owner_id = auth.uid()
      and x.eaten_at >= (from_date::timestamp at time zone public.my_time_zone())
      and x.eaten_at < ((to_date + 1)::timestamp at time zone public.my_time_zone())
  )
  select d, count(*)::int,
    sum((p->>'energy_kj')::numeric * grams / 100),
    sum((p->>'protein_g')::numeric * grams / 100),
    sum((p->>'fat_g')::numeric * grams / 100),
    sum((p->>'sat_fat_g')::numeric * grams / 100),
    sum((p->>'trans_fat_g')::numeric * grams / 100),
    sum((p->>'carbs_g')::numeric * grams / 100),
    sum((p->>'sugars_g')::numeric * grams / 100),
    sum((p->>'fibre_g')::numeric * grams / 100),
    sum((p->>'sodium_mg')::numeric * grams / 100),
    jsonb_build_object(
      'energy_kj', count(*) filter (where p->>'energy_kj' is null),
      'protein_g', count(*) filter (where p->>'protein_g' is null),
      'fat_g', count(*) filter (where p->>'fat_g' is null),
      'sat_fat_g', count(*) filter (where p->>'sat_fat_g' is null),
      'trans_fat_g', count(*) filter (where p->>'trans_fat_g' is null),
      'carbs_g', count(*) filter (where p->>'carbs_g' is null),
      'sugars_g', count(*) filter (where p->>'sugars_g' is null),
      'fibre_g', count(*) filter (where p->>'fibre_g' is null),
      'sodium_mg', count(*) filter (where p->>'sodium_mg' is null)
    )
  from e group by d order by d
$$;

-- Search ---------------------------------------------------------------------------------------

-- Ranking: foods you've logged (how often, how recently), then match quality, then source:
-- yours > label catalogue > FSANZ Branded > Open Food Facts > AUSNUT > AFCD.
create function public.search_foods(q text, lim int default 30)
returns table (
  id uuid, source text, visibility text, created_by uuid, barcode text,
  name text, display_name text, brand text,
  energy_kj numeric, serving_g numeric, pack_g numeric, total_weight_g numeric, serves numeric,
  is_liquid boolean, missing_nutrients text[],
  use_count int, last_used_at timestamptz, last_grams numeric, last_unit text, last_amount numeric,
  score real
)
language sql stable set search_path = public, extensions, pg_temp as $$
  with p as (
    select trim(regexp_replace(lower(coalesce(q, '')), '[^[:alnum:][:space:]]+', ' ', 'g')) as q
  ), t as (
    select p.q,
      nullif((select string_agg(w || ':*', ' & ') from regexp_split_to_table(p.q, '\s+') as w where w <> ''), '') as tq
    from p
  ), m as (
    select f.*,
      lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, '')) as hay,
      case when t.tq is null then 0 else ts_rank(f.search, to_tsquery('english', t.tq)) end as ts,
      word_similarity(t.q, lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, ''))) as ws,
      t.q as qq
    from public.foods f, t
    where t.q <> ''
      and (
        (t.tq is not null and f.search @@ to_tsquery('english', t.tq))
        or lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, '')) like '%' || t.q || '%'
        or word_similarity(t.q, lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, ''))) > 0.45
      )
  )
  select m.id, m.source, m.visibility, m.created_by, m.barcode, m.name, m.display_name, m.brand,
    m.energy_kj, m.serving_g, m.pack_g, m.total_weight_g, m.serves, m.is_liquid, m.missing_nutrients,
    s.use_count, s.last_used_at, s.last_grams, s.last_unit, s.last_amount,
    (greatest(m.ts * 2, m.ws) + case when m.hay like m.qq || '%' then 0.3 else 0 end)::real as score
  from m
  left join public.user_food_stats s on s.food_id = m.id and s.owner_id = auth.uid()
  order by
    (s.food_id is not null) desc,
    coalesce(ln(1 + s.use_count) + 1.0 / (1 + extract(epoch from (now() - s.last_used_at)) / 604800), 0) desc,
    (greatest(m.ts * 2, m.ws) + case when m.hay like m.qq || '%' then 0.3 else 0 end) desc,
    case m.source when 'user' then 1 when 'meal' then 1 when 'label' then 2 when 'fsanz_branded' then 3
      when 'off' then 4 when 'ausnut' then 5 when 'afcd' then 6 else 7 end,
    length(coalesce(m.display_name, m.name))
  limit greatest(1, least(coalesce(lim, 30), 100))
$$;

-- Row-level security ----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.weigh_ins enable row level security;
alter table public.daily_burn enable row level security;
alter table public.nutrient_targets enable row level security;
alter table public.ai_keys enable row level security;
alter table public.foods enable row level security;
alter table public.meal_ingredients enable row level security;
alter table public.food_measures enable row level security;
alter table public.meal_photos enable row level security;
alter table public.label_photos enable row level security;
alter table public.text_parses enable row level security;
alter table public.off_lookups enable row level security;
alter table public.log_entries enable row level security;
alter table public.user_food_stats enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own goals" on public.goals for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own weigh-ins" on public.weigh_ins for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own burn" on public.daily_burn for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own targets" on public.nutrient_targets for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- ai_keys and off_lookups: no policies. Service role only.

-- Shared rows are readable by everyone signed in; private rows only by their owner.
create policy "read foods" on public.foods for select to authenticated
  using (visibility = 'shared' or created_by = (select auth.uid()));
-- People write only their own private foods and meals. The shared catalogue is written by the server.
create policy "write own foods" on public.foods for insert to authenticated
  with check (visibility = 'private' and created_by = (select auth.uid()) and source in ('user', 'meal'));
create policy "update own foods" on public.foods for update to authenticated
  using (visibility = 'private' and created_by = (select auth.uid()))
  with check (visibility = 'private' and created_by = (select auth.uid()) and source in ('user', 'meal'));
create policy "delete own foods" on public.foods for delete to authenticated
  using (visibility = 'private' and created_by = (select auth.uid()));

create function public.owns_meal(p_meal uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.foods f
    where f.id = p_meal and f.source = 'meal' and f.created_by = auth.uid()
  )
$$;

create policy "own meal recipes" on public.meal_ingredients for all to authenticated
  using ((select public.owns_meal(meal_food_id))) with check ((select public.owns_meal(meal_food_id)));

create policy "read measures" on public.food_measures for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "write own measures" on public.food_measures for insert to authenticated
  with check (owner_id = (select auth.uid()) and source = 'user');
create policy "update own measures" on public.food_measures for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()) and source = 'user');
create policy "delete own measures" on public.food_measures for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "own meal photos" on public.meal_photos for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
-- Label photos are evidence for shared foods, so everyone can see them. Only the server writes them.
create policy "read label photos" on public.label_photos for select to authenticated using (true);
create policy "own text parses" on public.text_parses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "own log" on public.log_entries for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own stats" on public.user_food_stats for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke all on all tables in schema public from anon;
revoke all on public.ai_keys, public.off_lookups from authenticated;
grant select, insert, update, delete on
  public.profiles, public.goals, public.weigh_ins, public.daily_burn, public.nutrient_targets,
  public.foods, public.meal_ingredients, public.food_measures, public.meal_photos,
  public.log_entries, public.user_food_stats
  to authenticated;
grant select on public.label_photos, public.text_parses to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke execute on all functions in schema public from anon;

-- Storage ---------------------------------------------------------------------------------------

-- Meal photos are private to their owner. Label photos are readable by everyone signed in, as
-- evidence for the shared catalogue. Paths start with the uploader's user id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('meal-photos', 'meal-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('label-photos', 'label-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "meal photos: own" on storage.objects for all to authenticated
  using (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text)
  with check (bucket_id = 'meal-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "label photos: read" on storage.objects for select to authenticated
  using (bucket_id = 'label-photos');
create policy "label photos: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'label-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
