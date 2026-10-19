-- Search ranking with 23,000 Australian Open Food Facts products in the catalogue (Q3).
-- - Generic foods before branded products, unless you typed the brand: "banana" finds bananas
--   before "Banana chip", "chicken breast" finds FSANZ chicken before a supermarket's, while
--   "oatly barista" finds Oatly's. The brief ranked Open Food Facts above FSANZ when it only held
--   products someone had scanned; your own foods, meals and the label catalogue still come first.
-- - Match quality adds its parts instead of taking the larger, so a name that reads like what you
--   typed wins within a group.
-- - "Starts with what you typed" means whole words and ignores punctuation: "milk" favours
--   "Milk, cow, ..." over "Milkshake", and "chicken breast" matches "Chicken, breast, ...".
-- - When the first tier has fewer than three results, the next tiers fill in after it, so a typo
--   like "brocoli" still offers broccoli when one product happens to be called "Brocolis".
-- - Two more synonym groups for how FSANZ spells and names things.

insert into public.food_synonyms (term, expands_to)
select t, array(select x from unnest(g) as x where x <> t)
from (values
  (array['yogurt', 'yoghurt']),
  (array['full cream', 'regular fat'])
) as groups(g), unnest(g) as t
on conflict (term) do update set expands_to = excluded.expands_to;

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
    s.use_count, s.last_used_at, s.last_grams, s.last_unit, s.last_amount,
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
