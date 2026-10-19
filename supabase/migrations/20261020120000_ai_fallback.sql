-- Daniel's answers from testing on 20 Oct: Q4 (AI turns a phrase into database terms), Q5 (AI
-- nutrient estimates as a last resort, marked "AI estimate") and Q3 (Open Food Facts products by
-- name, which makes the typo tier of search worth indexing).

-- 1. Phrases the AI has already translated into database terms. Shared across everyone, like label
--    reads: the same normalised phrase never costs a second AI call. Written by the server only.
create table if not exists public.query_resolutions (
  normalised_phrase text primary key check (normalised_phrase <> ''),
  response_json jsonb not null,
  provider text,
  model text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.query_resolutions enable row level security;
drop policy if exists "read query resolutions" on public.query_resolutions;
create policy "read query resolutions" on public.query_resolutions for select to authenticated using (true);
grant select on public.query_resolutions to authenticated;
grant all on public.query_resolutions to service_role;

-- 2. AI estimates: private foods whose values came from the person's AI provider, not from data.
--    Only the server creates them, and only when the person asks for one.
alter table public.foods drop constraint if exists foods_source_check;
alter table public.foods add constraint foods_source_check
  check (source in ('user', 'label', 'meal', 'fsanz_branded', 'off', 'ausnut', 'afcd', 'ai'));
alter table public.foods drop constraint if exists foods_ai_private;
alter table public.foods add constraint foods_ai_private
  check (source <> 'ai' or (visibility = 'private' and created_by is not null));

-- Day totals also count, per nutrient, the entries whose value is an AI estimate, so Trends can
-- flag them the way it flags missing values. Entries keep their provenance in source_snapshot.
drop function if exists public.daily_totals(date, date);
create function public.daily_totals(from_date date, to_date date)
returns table (
  date date, entries int,
  energy_kj numeric, protein_g numeric, fat_g numeric, sat_fat_g numeric, trans_fat_g numeric,
  carbs_g numeric, sugars_g numeric, fibre_g numeric, sodium_mg numeric,
  missing jsonb,
  ai jsonb
)
language sql stable set search_path = '' as $$
  with e as (
    select (x.eaten_at at time zone public.my_time_zone())::date as d, x.grams, x.per100_snapshot as p,
      x.source_snapshot = 'AI estimate' as ai
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
    ),
    jsonb_build_object(
      'energy_kj', count(*) filter (where ai and p->>'energy_kj' is not null),
      'protein_g', count(*) filter (where ai and p->>'protein_g' is not null),
      'fat_g', count(*) filter (where ai and p->>'fat_g' is not null),
      'sat_fat_g', count(*) filter (where ai and p->>'sat_fat_g' is not null),
      'trans_fat_g', count(*) filter (where ai and p->>'trans_fat_g' is not null),
      'carbs_g', count(*) filter (where ai and p->>'carbs_g' is not null),
      'sugars_g', count(*) filter (where ai and p->>'sugars_g' is not null),
      'fibre_g', count(*) filter (where ai and p->>'fibre_g' is not null),
      'sodium_mg', count(*) filter (where ai and p->>'sodium_mg' is not null)
    )
  from e group by d order by d
$$;
revoke execute on function public.daily_totals(date, date) from public, anon;
grant execute on function public.daily_totals(date, date) to authenticated, service_role;

-- 3. The typo tier uses the trigram index (foods_name_trgm) through the <% operator, so search stays
--    fast with tens of thousands of products. Same ranking as before; AI estimates rank last.
create or replace function public.search_foods(q text, lim int default 30)
returns table (
  id uuid, source text, visibility text, created_by uuid, barcode text,
  name text, display_name text, brand text,
  energy_kj numeric, serving_g numeric, pack_g numeric, total_weight_g numeric, serves numeric,
  is_liquid boolean, missing_nutrients text[],
  use_count int, last_used_at timestamptz, last_grams numeric, last_unit text, last_amount numeric,
  score real, tier int
)
language plpgsql stable set search_path = public, extensions, pg_temp as $$
declare
  words text[] := public.normalise_food_query(q);
  n int := coalesce(array_length(words, 1), 0);
  terms tsquery[] := '{}';
  q_all tsquery;
  q_any tsquery;
  clean text;
  i int := 1;
  k int;
  phrase text;
  alts text[];
  matched boolean;
  term_q tsquery;
  lim2 int := greatest(1, least(coalesce(lim, 30), 100));
begin
  if n = 0 then
    return;
  end if;
  clean := array_to_string(words, ' ');

  -- Typos match from word similarity 0.45 (pg_trgm's default is 0.6). Supabase doesn't let a
  -- function definition set this, so it's set for this transaction; if that's refused, 0.6 applies.
  begin
    perform set_config('pg_trgm.word_similarity_threshold', '0.45', true);
  exception when others then
    null;
  end;

  -- Group words into terms: the longest synonym (up to three words) starting here, else one word.
  while i <= n loop
    matched := false;
    for k in reverse least(3, n - i + 1)..1 loop
      phrase := array_to_string(words[i:i + k - 1], ' ');
      select s.expands_to into alts from public.food_synonyms s where s.term = phrase;
      if found then
        terms := terms || public.food_term_query(phrase, alts);
        i := i + k;
        matched := true;
        exit;
      end if;
    end loop;
    if not matched then
      terms := terms || public.food_term_query(words[i], '{}');
      i := i + 1;
    end if;
  end loop;

  foreach term_q in array terms loop
    if term_q is null or numnode(term_q) = 0 then continue; end if;
    q_all := case when q_all is null then term_q else q_all && term_q end;
    q_any := case when q_any is null then term_q else q_any || term_q end;
  end loop;

  return query
  with cand as (
    select f.*,
      lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, '')) as hay,
      case
        when q_all is not null and f.search @@ q_all then 1
        when q_any is not null and f.search @@ q_any then 2
        else 3
      end as t,
      (select count(*) from unnest(terms) as tq where tq is not null and f.search @@ tq)::int as hits
    from public.foods f
    where (q_any is not null and f.search @@ q_any)
       or clean <% lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, ''))
  ), best as (
    select min(c.t) as t from cand c
  ), ranked as (
    select c.*,
      (greatest(
         case when q_any is not null then ts_rank(c.search, coalesce(q_all, q_any)) * 2 else 0 end,
         word_similarity(clean, c.hay)
       ) + case when c.hay like clean || '%' then 0.3 else 0 end)::real as quality
    from cand c join best b on c.t = b.t
  )
  select r.id, r.source, r.visibility, r.created_by, r.barcode, r.name, r.display_name, r.brand,
    r.energy_kj, r.serving_g, r.pack_g, r.total_weight_g, r.serves, r.is_liquid, r.missing_nutrients,
    s.use_count, s.last_used_at, s.last_grams, s.last_unit, s.last_amount,
    r.quality, r.t
  from ranked r
  left join public.user_food_stats s on s.food_id = r.id and s.owner_id = auth.uid()
  order by
    r.hits desc,
    (s.food_id is not null) desc,
    coalesce(ln(1 + s.use_count) + 1.0 / (1 + extract(epoch from (now() - s.last_used_at)) / 604800), 0) desc,
    r.quality desc,
    case r.source when 'user' then 1 when 'meal' then 1 when 'label' then 2 when 'fsanz_branded' then 3
      when 'off' then 4 when 'ausnut' then 5 when 'afcd' then 6 when 'ai' then 8 else 7 end,
    length(coalesce(r.display_name, r.name))
  limit lim2;
end $$;

revoke execute on function public.search_foods(text, int) from public, anon;
grant execute on function public.search_foods(text, int) to authenticated, service_role;

-- 4. How big the database is, for the admin (the free plan allows 500 MB). Service role only.
create or replace function public.admin_db_size()
returns table (database_bytes bigint, foods_bytes bigint, foods_rows bigint)
language sql stable security definer set search_path = '' as $$
  select pg_database_size(current_database()), pg_total_relation_size('public.foods'), (select count(*) from public.foods)
$$;
revoke execute on function public.admin_db_size() from public, anon, authenticated;
grant execute on function public.admin_db_size() to service_role;
