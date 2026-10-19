'use client';

// Search: type-ahead against our own database only (never Open Food Facts' search). The box
// accepts an amount with the food ("45 salad", "salad 45g", "250ml milk"). Before typing it shows
// your Meals, Recent and Frequent foods with their last amounts, so a repeat is one tap plus Save.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { BackButton, CapsLabel, Icon, Notice, Spinner } from '@/components/ui';
import { frequentFoods, myMeals, recentFoods, type ListedFood, type SearchResult } from '@/lib/data';
import { useFoodSearch } from '@/lib/useFoodSearch';
import { amountText, energyText, int } from '@/lib/format';
import { parseSearch } from '@/lib/parse';
import { SOURCE_TAG, type EnergyUnit } from '@/lib/types';

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <Search />
    </Suspense>
  );
}

interface RowData {
  id: string;
  name: string;
  sub: string | null;
  source: SearchResult['source'];
  is_liquid: boolean;
  energy_kj: number | null;
  last: { grams: number; amount: number | null; unit: 'g' | 'ml' | null } | null;
}

const fromListed = (l: ListedFood): RowData => ({
  id: l.food.id,
  name: l.food.display_name ?? l.food.name,
  sub: l.food.brand,
  source: l.food.source,
  is_liquid: l.food.is_liquid,
  energy_kj: l.food.energy_kj,
  last: l.stats?.last_grams ? { grams: l.stats.last_grams, amount: l.stats.last_amount, unit: l.stats.last_unit } : null,
});

const fromResult = (r: SearchResult): RowData => ({
  id: r.id,
  name: r.display_name ?? r.name,
  sub: r.brand,
  source: r.source,
  is_liquid: r.is_liquid,
  energy_kj: r.energy_kj,
  last: r.last_grams ? { grams: r.last_grams, amount: r.last_amount, unit: r.last_unit } : null,
});

function Search() {
  const app = useApp();
  const params = useSearchParams();
  const date = params.get('d') ?? undefined;
  const [q, setQ] = useState(params.get('q') ?? '');
  const parsed = useMemo(() => parseSearch(q), [q]);
  const search = useFoodSearch(parsed.text);
  const results = useMemo(() => search.results?.map(fromResult) ?? null, [search.results]);
  const searching = search.searching;
  const [listError, setError] = useState<string | null>(null);
  const error = listError ?? search.error;
  const [lists, setLists] = useState<{ meals: RowData[]; recent: RowData[]; frequent: RowData[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    Promise.all([myMeals(), recentFoods(), frequentFoods()])
      .then(([m, r, f]) => {
        const recentIds = new Set(r.map((x) => x.food.id));
        setLists({
          meals: m.slice(0, 8).map(fromListed),
          recent: r.map(fromListed),
          frequent: f.filter((x) => !recentIds.has(x.food.id)).map(fromListed),
        });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  function open(row: RowData) {
    app.openAmount({
      kind: 'food',
      foodId: row.id,
      preview: { name: row.name, source: row.source, is_liquid: row.is_liquid },
      prefill: parsed.amount != null || parsed.count != null ? { amount: parsed.amount, unit: parsed.unit, count: parsed.count } : undefined,
      method: 'search',
      date,
    });
  }

  const unit = app.profile.energy_unit;
  const showLists = results == null;

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pb-10">
      <div className="sticky top-0 z-20 -mx-4 flex items-center gap-1 bg-bg/90 px-2 py-2 backdrop-blur-md">
        <BackButton />
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-[24px] bg-raised px-4 focus-within:shadow-[0_0_0_2.5px_var(--cc-focus),0_0_0_8px_var(--cc-focus-glow)]">
          <Icon name="search" size={20} className="shrink-0 text-ink2" />
          <span className="sr-only">Search foods</span>
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results?.[0]) open(results[0]);
            }}
            placeholder="Food, or “45 salad”"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[17px] outline-none"
          />
          {searching && <Spinner label="Searching" />}
        </label>
      </div>

      {parsed.amount != null && parsed.text.length >= 2 && (
        <p className="mx-1 mt-2 text-[14px] text-ink2 tnum">
          Opens with {amountText(parsed.amount, parsed.unit ?? 'g')} filled in
        </p>
      )}
      {parsed.count != null && parsed.text.length >= 2 && (
        <p className="mx-1 mt-2 text-[14px] text-ink2 tnum">Opens with {parsed.count} × the usual measure filled in</p>
      )}
      <Notice tone="warn" className="mt-2">
        {error}
      </Notice>

      {showLists ? (
        lists ? (
          <>
            {lists.meals.length > 0 && <List title="Meals" rows={lists.meals} unit={unit} onOpen={open} more={<Link href="/meals" className="text-[14px] font-semibold text-accent">All meals</Link>} />}
            {lists.recent.length > 0 && <List title="Recent" rows={lists.recent} unit={unit} onOpen={open} />}
            {lists.frequent.length > 0 && <List title="Frequent" rows={lists.frequent} unit={unit} onOpen={open} />}
            {!lists.meals.length && !lists.recent.length && (
              <p className="mx-1 mt-6 text-[15px] leading-snug text-ink2">
                Type a food to search Australian food data (FSANZ), products people have added, and your own foods and meals.
              </p>
            )}
          </>
        ) : (
          <div className="mt-10 flex justify-center">
            <Spinner />
          </div>
        )
      ) : results && results.length > 0 ? (
        <List title="Results" rows={results} unit={unit} onOpen={open} showSource />
      ) : (
        !searching && <p className="mx-1 mt-6 text-[15px] text-ink2">Nothing found for “{parsed.text}”.</p>
      )}

      <div className="mt-6 flex flex-col gap-1 rounded-card bg-surface px-5 py-3 shadow-[var(--cc-card-shadow)]">
        <span className="text-[14px] text-ink2">Not finding it?</span>
        <Link href={`/log/scan${date ? `?d=${date}` : ''}`} className="min-h-11 py-2.5 text-[16px] font-semibold text-accent no-underline">
          Scan its barcode
        </Link>
        <Link href={`/log/label${date ? `?d=${date}` : ''}`} className="min-h-11 py-2.5 text-[16px] font-semibold text-accent no-underline">
          Add it from the label
        </Link>
      </div>
    </main>
  );
}

function List({ title, rows, unit, onOpen, showSource, more }: {
  title: string;
  rows: RowData[];
  unit: EnergyUnit;
  onOpen: (r: RowData) => void;
  showSource?: boolean;
  more?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <CapsLabel>{title}</CapsLabel>
        {more && <span className="mr-1">{more}</span>}
      </div>
      <section className="rounded-log-card bg-surface pl-5 pr-1.5 shadow-[var(--cc-card-shadow)]">
        {rows.map((r) => {
          const kj = r.energy_kj == null ? null : r.last ? (r.energy_kj * r.last.grams) / 100 : r.energy_kj;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpen(r)}
              className="flex min-h-[52px] w-full items-center gap-2.5 border-0 border-t border-separator bg-transparent py-2 pr-3.5 text-left first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-ink">{r.name}</span>
                {(showSource || r.sub) && (
                  <span className="block truncate text-[12px] text-ink2">
                    {[r.sub, showSource ? SOURCE_TAG[r.source] : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="text-right text-[13px] text-ink2 tnum">
                {r.last ? amountText(r.last.unit === 'ml' && r.last.amount ? r.last.amount : r.last.grams, r.last.unit ?? 'g') : 'per 100 g'}
              </span>
              <span className="w-12 text-right text-[15px] font-medium tnum">{kj == null ? '–' : r.last ? int(unit === 'kj' ? kj : kj / 4.184) : energyText(kj, unit, false)}</span>
            </button>
          );
        })}
      </section>
    </>
  );
}
