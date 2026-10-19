-- Amounts in the units people think in (testing on 20 Oct): a coffee is "1 regular cup", toast is
-- "2 slices". An entry can now be logged in a named measure as well as grams or millilitres:
-- entered_unit 'measure', entered_amount the count, entered_measure its name ("regular cup",
-- "slice", "cup", "tablespoon"). Grams stay the truth for every total; the measure is what you
-- typed, shown in the log and offered again next time.

alter table public.log_entries drop constraint if exists log_entries_entered_unit_check;
alter table public.log_entries add constraint log_entries_entered_unit_check check (entered_unit in ('g', 'ml', 'measure'));
alter table public.log_entries add column if not exists entered_measure text;
alter table public.log_entries drop constraint if exists log_entries_entered_measure_check;
alter table public.log_entries add constraint log_entries_entered_measure_check
  check ((entered_unit = 'measure') = (entered_measure is not null) and coalesce(length(entered_measure), 0) <= 80);

alter table public.user_food_stats drop constraint if exists user_food_stats_last_unit_check;
alter table public.user_food_stats add constraint user_food_stats_last_unit_check check (last_unit in ('g', 'ml', 'measure'));
alter table public.user_food_stats add column if not exists last_measure text;

-- Your last amount now includes its measure.
create or replace function public.log_entries_stats() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.food_id is null then return null; end if;
  if tg_op = 'INSERT' then
    insert into public.user_food_stats as s (owner_id, food_id, use_count, last_used_at, last_grams, last_unit, last_amount, last_measure)
    values (new.owner_id, new.food_id, 1, now(), new.grams, new.entered_unit, new.entered_amount, new.entered_measure)
    on conflict (owner_id, food_id) do update set
      use_count = s.use_count + 1,
      last_used_at = now(),
      last_grams = excluded.last_grams,
      last_unit = excluded.last_unit,
      last_amount = excluded.last_amount,
      last_measure = excluded.last_measure;
  elsif new.grams is distinct from old.grams or new.entered_unit is distinct from old.entered_unit
     or new.entered_measure is distinct from old.entered_measure then
    update public.user_food_stats
    set last_grams = new.grams, last_unit = new.entered_unit, last_amount = new.entered_amount, last_measure = new.entered_measure
    where owner_id = new.owner_id and food_id = new.food_id;
  end if;
  return null;
end $$;

-- Search returns the measure with your last amount ("Last · 1 regular cup"). Same ranking as the
-- previous migration; the function is recreated because its columns change.
drop function if exists public.search_foods(text, int);
create function public.search_foods(q text, lim int default 30)
returns table (
  id uuid, source text, visibility text, created_by uuid, barcode text,
  name text, display_name text, brand text,
  energy_kj numeric, serving_g numeric, pack_g numeric, total_weight_g numeric, serves numeric,
  is_liquid boolean, missing_nutrients text[],
  use_count int, last_used_at timestamptz, last_grams numeric, last_unit text, last_amount numeric, last_measure text,
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
      -- The same words with punctuation as spaces, for "starts with what you typed".
      trim(regexp_replace(lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, '')), '[^[:alnum:]]+', ' ', 'g')) as plain,
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
    select min(c.t) as t, count(*) filter (where c.t = (select min(t) from cand)) as best_n from cand c
  ), ranked as (
    -- Match quality adds up: how well the words match (full-text rank), how closely the name reads
    -- like what you typed (word similarity), and a bonus when it starts with it.
    select c.*,
      (least(case when q_any is not null then ts_rank(c.search, coalesce(q_all, q_any)) else 0 end, 1)
       + word_similarity(clean, c.hay)
       + case when c.plain = clean or c.plain like clean || ' %' then 0.3 else 0 end)::real as quality,
      cov.coverage,
      -- Branded products (Open Food Facts, FSANZ Branded) come after generic foods unless you typed
      -- their brand: a word of yours in the brand and not the name, with the name covering the rest
      -- of what you typed ("oatly barista"), or the brand alone when you typed one word ("oatly").
      case when c.source in ('off', 'fsanz_branded')
        and not (cov.brand_only > 0 and (n = 1 or cov.name_hits > 0)) then 2 else 1 end as grp
    from cand c
    cross join best b
    -- Which of your words the name and the brand contain as whole words ("eggs" counts "egg").
    cross join lateral (
      select
        count(*) filter (where y.nm or y.br)::int as coverage,
        count(*) filter (where y.br and not y.nm)::int as brand_only,
        count(*) filter (where y.nm)::int as name_hits
      from (
        select
          (x.pn like '% ' || w || ' %' or (w like '%_s' and x.pn like '% ' || left(w, -1) || ' %')) as nm,
          (x.pb like '% ' || w || ' %') as br
        from unnest(words) as w,
          lateral (select
            ' ' || trim(regexp_replace(lower(coalesce(c.display_name, c.name)), '[^[:alnum:]]+', ' ', 'g')) || ' ' as pn,
            ' ' || trim(regexp_replace(lower(coalesce(c.brand, '')), '[^[:alnum:]]+', ' ', 'g')) || ' ' as pb) as x
      ) as y
    ) as cov
    -- The first tier with results; when it has fewer than three, the next tiers fill in after it.
    where c.t = b.t or b.best_n < 3
  )
  select r.id, r.source, r.visibility, r.created_by, r.barcode, r.name, r.display_name, r.brand,
    r.energy_kj, r.serving_g, r.pack_g, r.total_weight_g, r.serves, r.is_liquid, r.missing_nutrients,
    s.use_count, s.last_used_at, s.last_grams, s.last_unit, s.last_amount, s.last_measure,
    r.quality, r.t
  from ranked r
  left join public.user_food_stats s on s.food_id = r.id and s.owner_id = auth.uid()
  order by
    r.t,
    r.hits desc,
    (s.food_id is not null) desc,
    coalesce(ln(1 + s.use_count) + 1.0 / (1 + extract(epoch from (now() - s.last_used_at)) / 604800), 0) desc,
    r.grp,
    r.coverage desc,
    r.quality desc,
    case r.source when 'user' then 1 when 'meal' then 1 when 'label' then 2 when 'fsanz_branded' then 3
      when 'ausnut' then 4 when 'afcd' then 5 when 'off' then 6 when 'ai' then 8 else 7 end,
    length(coalesce(r.display_name, r.name))
  limit lim2;
end $$;

revoke execute on function public.search_foods(text, int) from public, anon;
grant execute on function public.search_foods(text, int) to authenticated, service_role;
