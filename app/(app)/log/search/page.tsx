'use client';

// Search: type-ahead against our own database only (never Open Food Facts' search). The box
// accepts an amount with the food ("45 salad", "salad 45g", "250ml milk"). Before typing it shows
// your Meals, Recent and Frequent foods with their last amounts, so a repeat is one tap plus Save.
// When results are empty or only close spellings, and you have an AI key: "Ask AI to find this"
// rewords it into database terms (item 4), and "Use an AI estimate" is the last resort (Q5).

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { BackButton, Button, CapsLabel, Icon, Notice, Spinner } from '@/components/ui';
import { PROVIDER_BY_ID } from '@/lib/ai/config';
import { aiEstimate, AiCallError, askAiToFind } from '@/lib/ai-fallback';
import { frequentFoods, myMeals, recentFoods, type ListedFood, type SearchResult } from '@/lib/data';
import type { Candidate, Draft, DraftItem } from '@/lib/drafts';
import type { ResolveResponse } from '@/lib/resolution';
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
  last: { grams: number; amount: number | null; unit: 'g' | 'ml' | 'measure' | null; measure?: string | null } | null;
  /** The size it's counted in ("egg", 51 g), shown instead of "per 100 g". */
  natural?: { label: string; grams: number } | null;
}

const fromListed = (l: ListedFood): RowData => ({
  id: l.food.id,
  name: l.food.display_name ?? l.food.name,
  sub: l.food.brand,
  source: l.food.source,
  is_liquid: l.food.is_liquid,
  energy_kj: l.food.energy_kj,
  last: l.stats?.last_grams ? { grams: l.stats.last_grams, amount: l.stats.last_amount, unit: l.stats.last_unit, measure: l.stats.last_measure } : null,
});

const fromCandidate = (c: Candidate): RowData => ({
  id: c.id,
  name: c.display_name ?? c.name,
  sub: c.brand,
  source: c.source as RowData['source'],
  is_liquid: c.is_liquid,
  energy_kj: c.energy_kj,
  last: c.last_grams ? { grams: c.last_grams, amount: null, unit: null } : null,
});

type AiState = { q: string; busy: 'find' | 'estimate' | null; found?: ResolveResponse; error?: { message: string; settings: boolean } };

const fromResult = (r: SearchResult): RowData => ({
  id: r.id,
  name: r.display_name ?? r.name,
  sub: r.brand,
  source: r.source,
  is_liquid: r.is_liquid,
  energy_kj: r.energy_kj,
  last: r.last_grams ? { grams: r.last_grams, amount: r.last_amount, unit: r.last_unit, measure: r.last_measure } : null,
  natural: r.natural ?? null,
});

function Search() {
  const app = useApp();
  const router = useRouter();
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
  // The AI fallbacks belong to the words they were asked about; typing something else hides them.
  const [aiState, setAi] = useState<AiState | null>(null);
  const ai = aiState && aiState.q === parsed.text ? aiState : null;
  const providerName = app.aiKey ? PROVIDER_BY_ID[app.aiKey.provider].name : 'AI';
  const weak =
    !!app.aiKey && parsed.text.length >= 3 && !searching && search.results != null && (search.results.length === 0 || search.results[0].tier === 3);
  const grams = parsed.amount != null && parsed.count == null ? parsed.amount : null;

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

  async function askAi() {
    const q = parsed.text;
    setAi({ q, busy: 'find' });
    try {
      setAi({ q, busy: null, found: await askAiToFind(q, grams) });
    } catch (e) {
      setAi({ q, busy: null, error: { message: e instanceof Error ? e.message : "That didn't work.", settings: e instanceof AiCallError && e.settings } });
    }
  }

  async function estimate() {
    const q = parsed.text;
    setAi((a) => ({ ...(a?.q === q ? a : {}), q, busy: 'estimate', error: undefined }));
    try {
      const c = await aiEstimate(q);
      setAi((a) => ({ ...(a ?? { q }), busy: null }));
      open(fromCandidate(c));
    } catch (e) {
      setAi((a) => ({ ...(a ?? { q }), busy: null, error: { message: e instanceof Error ? e.message : "That didn't work.", settings: e instanceof AiCallError && e.settings } }));
    }
  }

  /** A split goes to meal confirm as rows, like a typed meal. */
  function checkSplit(items: DraftItem[]) {
    const key = Date.now().toString(36);
    const draft: Draft = { kind: 'text', text: parsed.text, items };
    sessionStorage.setItem(`fatty:draft:text:${key}`, JSON.stringify(draft));
    const qs = new URLSearchParams({ text: key });
    if (date) qs.set('d', date);
    router.push(`/log/confirm?${qs}`);
  }

  const unit = app.profile.energy_unit;
  const showLists = results == null;
  const found = ai?.found?.resolution;

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

      {weak && !ai?.found && (
        <button
          type="button"
          onClick={askAi}
          disabled={!!ai?.busy}
          className="press mt-3 flex min-h-[52px] w-full items-center gap-3 rounded-log-card border-0 bg-surface px-5 text-left shadow-[var(--cc-card-shadow)]"
        >
          <Icon name="search" size={20} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold text-accent">{ai?.busy === 'find' ? `Asking ${providerName}…` : 'Ask AI to find this'}</span>
            <span className="block text-[12px] text-ink2">{providerName} rewords it the way the food database names things</span>
          </span>
          {ai?.busy === 'find' && <Spinner label="Asking" />}
        </button>
      )}
      {found?.kind === 'match' && <List title="Found by AI" rows={found.candidates.map(fromCandidate)} unit={unit} onOpen={open} showSource />}
      {found?.kind === 'split' && ai?.found?.items && (
        <>
          <CapsLabel>AI split it into</CapsLabel>
          <section className="rounded-log-card bg-surface pb-3 pl-5 pr-4 shadow-[var(--cc-card-shadow)]">
            {ai.found.items.map((i) => (
              <div key={i.key} className="flex min-h-[46px] items-center gap-2.5 border-t border-separator py-2 first:border-t-0">
                <span className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug">
                  {i.candidates[0] ? (i.candidates[0].display_name ?? i.candidates[0].name) : <>{i.label} <span className="text-ink2">· not matched</span></>}
                </span>
                <span className="text-[13px] text-ink2 tnum">≈ {int(i.grams ?? 0)} g</span>
              </div>
            ))}
            <Button size="md" onClick={() => checkSplit(ai.found!.items!)} className="mt-1 w-full">
              Check and log these
            </Button>
          </section>
        </>
      )}
      {found?.kind === 'none' && <p className="mx-1 mt-4 text-[15px] text-ink2">{providerName} couldn&apos;t find a match in the food database either.</p>}
      <Notice tone="warn" className="mt-2">
        {ai?.error && (
          <>
            {ai.error.message}
            {ai.error.settings && (
              <>
                {' '}
                <Link href="/settings#ai" className="font-semibold text-accent">
                  Settings
                </Link>
              </>
            )}
          </>
        )}
      </Notice>

      <div className="mt-6 flex flex-col gap-1 rounded-card bg-surface px-5 py-3 shadow-[var(--cc-card-shadow)]">
        <span className="text-[14px] text-ink2">Not finding it?</span>
        <Link href={`/log/scan${date ? `?d=${date}` : ''}`} className="min-h-11 py-2.5 text-[16px] font-semibold text-accent no-underline">
          Scan its barcode
        </Link>
        <Link href={`/log/label${date ? `?d=${date}` : ''}`} className="min-h-11 py-2.5 text-[16px] font-semibold text-accent no-underline">
          Add it from the label
        </Link>
        {weak && (
          <>
            <button type="button" onClick={estimate} disabled={!!ai?.busy} className="flex min-h-11 items-center gap-2 border-0 bg-transparent p-0 py-2.5 text-left text-[16px] font-semibold text-accent">
              {ai?.busy === 'estimate' ? 'Estimating…' : 'Use an AI estimate'}
              {ai?.busy === 'estimate' && <Spinner label="Estimating" />}
            </button>
            <span className="-mt-1.5 pb-1 text-[12px] leading-snug text-ink2">
              {providerName} estimates the values for “{parsed.text}”. They&apos;re marked AI estimate wherever they&apos;re counted.
            </span>
          </>
        )}
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
          // Your last amount if you've had it; else the size it's counted in ("1 egg"); else per 100 g.
          const grams = r.last?.grams ?? r.natural?.grams ?? null;
          const kj = r.energy_kj == null ? null : grams ? (r.energy_kj * grams) / 100 : r.energy_kj;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onOpen(r)}
              className="flex min-h-[52px] w-full items-center gap-2.5 border-0 border-t border-separator bg-transparent py-2 pr-3.5 text-left first:border-t-0"
            >
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[15px] leading-snug text-ink">{r.name}</span>
                {(showSource || r.sub) && (
                  <span className="block truncate text-[12px] text-ink2">
                    {[r.sub, showSource ? SOURCE_TAG[r.source] : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span className="max-w-[38%] shrink-0 truncate text-right text-[13px] text-ink2 tnum">
                {r.last
                  ? r.last.unit && r.last.unit !== 'g' && r.last.amount
                    ? amountText(r.last.amount, r.last.unit, r.last.measure)
                    : amountText(r.last.grams, 'g')
                  : r.natural
                    ? `1 ${r.natural.label}`
                    : 'per 100 g'}
              </span>
              <span className="w-12 text-right text-[15px] font-medium tnum">{kj == null ? '–' : grams ? int(unit === 'kj' ? kj : kj / 4.184) : energyText(kj, unit, false)}</span>
            </button>
          );
        })}
      </section>
    </>
  );
}
