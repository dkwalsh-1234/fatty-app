-- Search that copes with phrases like the AI's ("Flat white (oat milk)") and with FSANZ names
-- like "Coffee, flat white/cappuccino/latte, single shot & cereal based milk (rice/oat)".
-- No AI here: normalise the query, expand synonyms, then search in tiers.

-- 1. Index names with punctuation turned into spaces. Postgres otherwise reads "white/cappuccino"
--    and "(rice/oat)" as single words, so "white" and "oat" never matched them. Names and brand
--    are weighted A and B; descriptions (common_names) are kept at D and not matched on.
drop index if exists public.foods_search;
alter table public.foods drop column if exists search;
alter table public.foods add column search tsvector generated always as (
  setweight(to_tsvector('english'::regconfig,
    regexp_replace(coalesce(display_name, '') || ' ' || coalesce(name, ''), '[^[:alnum:][:space:]]+', ' ', 'g')), 'A') ||
  setweight(to_tsvector('english'::regconfig,
    regexp_replace(coalesce(brand, ''), '[^[:alnum:][:space:]]+', ' ', 'g')), 'B') ||
  setweight(to_tsvector('english'::regconfig,
    regexp_replace(coalesce(common_names, ''), '[^[:alnum:][:space:]]+', ' ', 'g')), 'D')
) stored;
create index foods_search on public.foods using gin (search);

-- 2. Synonyms, applied while normalising a query. A term (lower case, no punctuation, up to three
--    words) expands to other phrasings; any one of them matching counts as a match for that term.
create table if not exists public.food_synonyms (
  term text primary key check (term = lower(term) and term !~ '[^a-z0-9 ]'),
  expands_to text[] not null
);
alter table public.food_synonyms enable row level security;
drop policy if exists "read synonyms" on public.food_synonyms;
create policy "read synonyms" on public.food_synonyms for select to authenticated using (true);
grant select on public.food_synonyms to authenticated;
grant all on public.food_synonyms to service_role;

-- Each group: every member expands to the others. "cereal based milk", "dairy milk alternative",
-- "legume based milk" and "nut based milk" are how AUSNUT names plant milks.
insert into public.food_synonyms (term, expands_to)
select t, array(select x from unnest(g) as x where x <> t)
from (values
  (array['oat', 'oat milk', 'oat beverage', 'plant based milk', 'cereal based milk', 'dairy milk alternative']),
  (array['soy', 'soy milk', 'soy beverage', 'legume based milk']),
  (array['almond milk', 'almond beverage', 'nut based milk']),
  (array['flat white', 'coffee flat white']),
  (array['latte', 'coffee latte']),
  (array['cappuccino', 'coffee cappuccino']),
  (array['long black', 'coffee long black']),
  (array['mince', 'minced']),
  (array['capsicum', 'pepper sweet'])
) as groups(g), unnest(g) as t
on conflict (term) do update set expands_to = excluded.expands_to;

-- 3. Normalise: lower case, punctuation and brackets out, amounts and units out, filler words out.
create or replace function public.normalise_food_query(q text) returns text[]
language sql immutable set search_path = '' as $$
  select coalesce(array_agg(w order by ord), '{}')
  from regexp_split_to_table(
    trim(regexp_replace(regexp_replace(lower(coalesce(q, '')), '[^[:alnum:][:space:]]+', ' ', 'g'), '\s+', ' ', 'g')),
    ' '
  ) with ordinality as t(w, ord)
  where w <> ''
    and w !~ '^[0-9]+([.,][0-9]+)?$'
    and w !~ '^[0-9]+([.,][0-9]+)?(g|gm|gms|kg|kgs|ml|mls|l|oz|lb|lbs)$'
    and w not in (
      'with', 'a', 'an', 'of', 'and', 'the', 'some', 'in', 'on', 'plus', 'to', 'for', 'my',
      'g', 'gm', 'gms', 'gram', 'grams', 'kg', 'kgs', 'ml', 'mls', 'l', 'litre', 'litres', 'liter', 'liters',
      'oz', 'ounce', 'ounces', 'lb', 'lbs', 'cup', 'cups', 'tsp', 'tbsp', 'teaspoon', 'teaspoons',
      'tablespoon', 'tablespoons', 'serve', 'serves'
    )
$$;

-- One term as a tsquery: its own words, or any of its expansions. Prefix matching, names and brand only.
create or replace function public.food_term_query(term text, alternatives text[]) returns tsquery
language sql stable set search_path = public, pg_temp as $$
  select to_tsquery('english', string_agg('(' || phrase_q || ')', ' | '))
  from (
    select (select string_agg(w || ':*AB', ' & ') from regexp_split_to_table(p, '\s+') as w where w <> '') as phrase_q
    from unnest(array[term] || coalesce(alternatives, '{}')) as p
  ) s
  where phrase_q is not null
$$;

-- 4. Tiered search. Tier 1: every term matches. Tier 2: any term matches, more terms first.
--    Tier 3: trigram similarity, for typos ("brocoli"). The first tier with results wins; inside a
--    tier the usual order applies: foods you've logged (how often, how recently), match quality,
--    then source (yours > label catalogue > FSANZ Branded > Open Food Facts > AUSNUT > AFCD).
drop function if exists public.search_foods(text, int);
create function public.search_foods(q text, lim int default 30)
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
       or word_similarity(clean, lower(coalesce(f.display_name, f.name) || ' ' || coalesce(f.brand, ''))) > 0.45
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
      when 'off' then 4 when 'ausnut' then 5 when 'afcd' then 6 else 7 end,
    length(coalesce(r.display_name, r.name))
  limit lim2;
end $$;

revoke execute on function public.search_foods(text, int) from anon;
grant execute on function public.search_foods(text, int) to authenticated;
