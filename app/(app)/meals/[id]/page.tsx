'use client';

// Meal editor (design 04): name; ingredient rows (food, grams) added by search or barcode; total
// weight as the sum of ingredients or a cooked weight off the scales; serves; live per-100 g and
// per-serve nutrients; log from this meal. The database recomputes the meal's per-100 g on save.

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { NutritionCard } from '@/components/app/NutritionCard';
import { BackButton, Chip, cx, Dock, DockButton, Icon, Notice, Sheet, Spinner } from '@/components/ui';
import { amountString, cleanTyped, mealPer100, parseTyped } from '@/lib/amount';
import { DEFAULT_MEAL_BOUNDARIES, localTime, MEAL_LABEL, mealForTime, shortDate, zonedToUtc, type Meal } from '@/lib/dates';
import { dayEntries, getFood, getStats, mealIngredients, saveMeal } from '@/lib/data';
import { useFoodSearch } from '@/lib/useFoodSearch';
import { energyIn, energyText, grams as fmtGrams, int, unitLabel } from '@/lib/format';
import { saveEntries } from '@/lib/logging';
import { scale } from '@/lib/nutrients';
import { SOURCE_TAG, type Food, type FoodStats } from '@/lib/types';

export default function MealEditorPage() {
  return (
    <Suspense fallback={null}>
      <MealEditor />
    </Suspense>
  );
}

interface Ing {
  food: Food;
  grams: number;
}

interface Stored {
  name: string;
  serves: number | null;
  mode: 'sum' | 'cooked';
  cooked: string;
  ingredients: { id: string; grams: number }[];
  at: number;
}

function MealEditor() {
  const app = useApp();
  const router = useRouter();
  const { id: rawId } = useParams<{ id: string }>();
  const params = useSearchParams();
  const isNew = rawId === 'new';
  const [mealId, setMealId] = useState<string | null>(isNew ? null : rawId);
  const [meal, setMeal] = useState<Food | null>(null);
  const [stats, setStats] = useState<FoodStats | null>(null);
  const [name, setName] = useState('');
  const [serves, setServes] = useState<number | null>(null);
  const [mode, setMode] = useState<'sum' | 'cooked'>('sum');
  const [cooked, setCooked] = useState('');
  const [ings, setIngs] = useState<Ing[] | null>(null);
  const [dirty, setDirty] = useState(isNew);
  const [searching, setSearching] = useState(false);
  const [logAmount, setLogAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storeKey = `fatty:meal-editor:${rawId}`;

  const addIngredient = useCallback(
    (food: Food) => {
      app.openAmount({
        kind: 'pick',
        foodId: food.id,
        food,
        saveLabel: 'Add',
        onPick: ({ grams }) => {
          setIngs((xs) => [...(xs ?? []), { food, grams }]);
          setDirty(true);
        },
      });
    },
    [app],
  );

  // Load the meal (or start a new one, possibly from a logged meal group), restoring an
  // unsaved draft after a trip to the barcode scanner.
  useEffect(() => {
    (async () => {
      const stored: Stored | null = JSON.parse(sessionStorage.getItem(storeKey) ?? 'null');
      if (stored && Date.now() - stored.at < 3_600_000) {
        const foods = await Promise.all(stored.ingredients.map((i) => getFood(i.id).then((f) => ({ food: f, grams: i.grams })).catch(() => null)));
        setName(stored.name);
        setServes(stored.serves);
        setMode(stored.mode);
        setCooked(stored.cooked);
        setIngs(foods.filter((x): x is Ing => !!x));
        setDirty(true);
      } else if (!isNew) {
        const [m, list, s] = await Promise.all([getFood(rawId), mealIngredients(rawId), getStats(rawId)]);
        setMeal(m);
        setStats(s);
        if (s?.last_grams) setLogAmount(amountString(s.last_grams));
        setName(m.display_name ?? m.name);
        setServes(m.serves);
        setMode(m.cooked_weight_g ? 'cooked' : 'sum');
        setCooked(m.cooked_weight_g ? amountString(m.cooked_weight_g) : '');
        setIngs(list.map((i) => ({ food: i.food, grams: i.grams })));
      } else {
        const fromDate = params.get('fromDate');
        const fromMeal = params.get('meal') as Meal | null;
        if (fromDate && fromMeal) {
          const entries = (await dayEntries(fromDate)).filter((e) => e.meal === fromMeal && e.food_id);
          const foods = await Promise.all(entries.map((e) => getFood(e.food_id!).then((f) => ({ food: f, grams: e.grams })).catch(() => null)));
          setIngs(foods.filter((x): x is Ing => !!x));
          setName(`${MEAL_LABEL[fromMeal]}, ${shortDate(fromDate)}`);
        } else {
          setIngs([]);
        }
      }
      // Back from the scanner with a food for this meal?
      const picked = JSON.parse(sessionStorage.getItem('fatty:picked-ingredient') ?? 'null') as { id: string; at: number } | null;
      if (picked && Date.now() - picked.at < 600_000) {
        sessionStorage.removeItem('fatty:picked-ingredient');
        addIngredient(await getFood(picked.id));
      }
    })().catch((e: Error) => setError(e.message));
    // Load once per meal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawId]);

  // Keep an unsaved draft so a trip to the scanner doesn't lose it.
  useEffect(() => {
    if (!ings || !dirty) return;
    const s: Stored = { name, serves, mode, cooked, ingredients: ings.map((i) => ({ id: i.food.id, grams: i.grams })), at: Date.now() };
    sessionStorage.setItem(storeKey, JSON.stringify(s));
  }, [name, serves, mode, cooked, ings, dirty, storeKey]);

  const sum = (ings ?? []).reduce((s, i) => s + i.grams, 0);
  const cookedG = parseTyped(cooked);
  const calc = useMemo(
    () => mealPer100((ings ?? []).map((i) => ({ per100: i.food, grams: i.grams })), { cookedWeight: mode === 'cooked' ? cookedG : null, originalRawSum: sum }),
    [ings, mode, cookedG, sum],
  );
  const total = calc.totalWeight;
  const serveG = serves && total ? total / serves : null;
  const unit = app.profile.energy_unit;
  const u = unitLabel(unit);
  const logG = parseTyped(logAmount);
  const logPreview = logG ? scale(calc.per100, logG) : null;

  async function save(): Promise<Food | null> {
    setError(null);
    if (!name.trim()) {
      setError('Give the meal a name.');
      return null;
    }
    if (mode === 'cooked' && !cookedG) {
      setError('Type the cooked weight, or use the sum of ingredients.');
      return null;
    }
    setBusy(true);
    try {
      const saved = await saveMeal({
        id: mealId ?? undefined,
        name: name.trim(),
        serves,
        cooked_weight_g: mode === 'cooked' ? cookedG : null,
        ingredients: (ings ?? []).map((i) => ({ food_id: i.food.id, grams: i.grams })),
      });
      sessionStorage.removeItem(storeKey);
      setMeal(saved);
      setMealId(saved.id);
      setDirty(false);
      if (isNew) router.replace(`/meals/${saved.id}`);
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the meal.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function log() {
    if (!logG) return setError('Type how many grams you ate.');
    const m = dirty || !meal ? await save() : meal;
    if (!m) return;
    setBusy(true);
    try {
      const tz = app.profile.time_zone;
      await saveEntries(
        [
          {
            eaten_at: zonedToUtc(app.today, localTime(tz), tz).toISOString(),
            meal: mealForTime(localTime(tz), app.profile.meal_boundaries ?? DEFAULT_MEAL_BOUNDARIES),
            food_id: m.id,
            food_name_snapshot: m.display_name ?? m.name,
            source_snapshot: SOURCE_TAG.meal,
            grams: logG,
            entered_amount: logG,
            entered_unit: 'g',
            per100_snapshot: m,
            method: 'meal',
          },
        ],
        tz,
      );
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log it.");
      setBusy(false);
    }
  }

  if (!ings) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        {error ? <Notice tone="warn">{error}</Notice> : <Spinner />}
      </div>
    );
  }

  const chips = [
    stats?.last_grams ? { label: `Last · ${int(stats.last_grams)} g`, g: stats.last_grams } : null,
    serveG ? { label: `1 serve · ${int(serveG)} g`, g: serveG } : null,
    total ? { label: `Half · ${int(total / 2)} g`, g: total / 2 } : null,
    total ? { label: `Whole · ${int(total)} g`, g: total } : null,
  ].filter((c): c is { label: string; g: number } => !!c);

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pb-dock">
      <header className="-mx-1 flex h-14 items-center justify-between">
        <BackButton href="/meals" label="Back to meals" />
        <span className="text-base font-semibold">{isNew ? 'New meal' : 'Edit meal'}</span>
        <span className="w-11" />
      </header>
      <div className="flex flex-col items-center gap-1 px-1 pb-4 pt-2">
        <label htmlFor="meal-name" className="sr-only">
          Meal name
        </label>
        <input
          id="meal-name"
          value={name}
          placeholder="Meal name"
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          className="w-full border-0 bg-transparent p-0 text-center text-[30px] font-semibold tracking-[-0.025em] outline-none placeholder:text-ink3"
        />
        <span className="text-sm text-ink2 tnum">
          {calc.per100.energy_kj == null ? 'Energy unknown' : `${energyText(calc.per100.energy_kj, unit)} per 100 g`}
          {serveG && calc.per100.energy_kj != null && ` · ${int(energyIn((calc.per100.energy_kj * serveG) / 100, unit))} per serve`}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <section aria-label="Ingredients" className="rounded-card bg-surface pb-2.5 pl-5 pr-2 pt-1.5 shadow-[var(--cc-card-shadow)]">
          <div className="flex h-10 items-center pr-3">
            <span className="flex-1 text-[17px] font-semibold">Ingredients</span>
            <span className="text-[13px] text-ink2">{ings.length}</span>
          </div>
          {ings.map((i, idx) => {
            const kj = i.food.energy_kj == null ? null : (i.food.energy_kj * i.grams) / 100;
            const label = i.food.display_name ?? i.food.name;
            return (
              <div key={`${i.food.id}-${idx}`} className="flex h-[50px] items-center gap-2.5 border-t border-separator">
                <span className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug">{label}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`${label}, grams`}
                  value={amountString(i.grams)}
                  onChange={(e) => {
                    const g = parseTyped(cleanTyped(e.target.value)) ?? 0;
                    setIngs((xs) => xs!.map((x, j) => (j === idx ? { ...x, grams: g } : x)));
                    setDirty(true);
                  }}
                  className="h-[34px] w-[66px] rounded-[17px] border-0 bg-raised px-3 text-right text-[15px] font-medium outline-none tnum focus:shadow-[0_0_0_2px_var(--cc-focus)]"
                />
                <span className="w-[42px] text-right text-[13px] text-ink2 tnum">{kj == null ? '–' : int(energyIn(kj, unit))}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => {
                    setIngs((xs) => xs!.filter((_, j) => j !== idx));
                    setDirty(true);
                  }}
                  className="flex h-11 w-9 items-center justify-center border-0 bg-transparent p-0 text-ink2"
                >
                  <Icon name="remove" size={20} />
                </button>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2 pr-3 pt-2">
            <button type="button" onClick={() => setSearching(true)} className="press flex h-11 items-center justify-center gap-2 rounded-[22px] border-0 bg-raised text-sm font-semibold">
              <Icon name="search" size={18} stroke={1.9} />
              Add by search
            </button>
            <button
              type="button"
              onClick={() => {
                setDirty(true);
                sessionStorage.setItem(storeKey, JSON.stringify({ name, serves, mode, cooked, ingredients: ings.map((i) => ({ id: i.food.id, grams: i.grams })), at: Date.now() } satisfies Stored));
                router.push('/log/scan?for=ingredient');
              }}
              className="press flex h-11 items-center justify-center gap-2 rounded-[22px] border-0 bg-raised text-sm font-semibold"
            >
              <Icon name="scan" size={18} stroke={1.9} />
              Add by scan
            </button>
          </div>
        </section>

        <section aria-label="Total weight and serves" className="flex flex-col gap-3.5 rounded-card bg-surface px-5 py-4 shadow-[var(--cc-card-shadow)]">
          <span className="text-[17px] font-semibold">Total weight</span>
          <div role="radiogroup" aria-label="Total weight" className="grid grid-cols-2 rounded-[26px] bg-raised p-1">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'sum'}
              onClick={() => {
                setMode('sum');
                setDirty(true);
              }}
              className={cx('flex h-[52px] flex-col items-center justify-center rounded-[22px] border-0 text-xs', mode === 'sum' ? 'bg-primary font-semibold text-on-primary' : 'bg-transparent text-ink2')}
            >
              Sum of ingredients
              <span className="text-[17px] font-medium tnum">{int(sum)} g</span>
            </button>
            <label
              className={cx('flex h-[52px] cursor-text flex-col items-center justify-center rounded-[22px] text-xs', mode === 'cooked' ? 'bg-primary font-semibold text-on-primary' : 'text-ink2')}
              onClick={() => mode !== 'cooked' && (setMode('cooked'), setDirty(true))}
            >
              Cooked, from scales
              <span className="flex items-baseline text-[17px] font-medium tnum">
                <input
                  inputMode="decimal"
                  aria-label="Cooked weight in grams"
                  value={cooked}
                  placeholder="type"
                  onFocus={() => mode !== 'cooked' && setMode('cooked')}
                  onChange={(e) => {
                    setCooked(cleanTyped(e.target.value));
                    setMode('cooked');
                    setDirty(true);
                  }}
                  className="w-[70px] border-0 bg-transparent p-0 text-right text-inherit outline-none placeholder:text-current placeholder:opacity-60"
                  style={{ color: 'inherit' }}
                />
                &nbsp;g
              </span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[15px]">
              {serves ? (
                <>
                  Makes <b className="font-semibold">{serves}</b> <span className="text-ink2">· {serveG ? `${int(serveG)} g each` : ''}</span>
                </>
              ) : (
                <span className="text-ink2">Serves (optional)</span>
              )}
            </span>
            <button type="button" aria-label="Fewer serves" disabled={!serves} onClick={() => { setServes(serves && serves > 1 ? serves - 1 : null); setDirty(true); }} className="press h-11 w-11 rounded-full border-0 bg-raised text-xl disabled:text-ink3">
              −
            </button>
            <button type="button" aria-label="More serves" onClick={() => { setServes((serves ?? 0) + 1); setDirty(true); }} className="press h-11 w-11 rounded-full border-0 bg-raised text-xl">
              +
            </button>
          </div>
        </section>

        <NutritionCard per100={calc.per100} serveGrams={serveG} unit={unit} />

        <section aria-label="Log from this meal" className="flex flex-col gap-3 rounded-card bg-surface px-5 py-4 shadow-[var(--cc-card-shadow)]">
          <div className="flex items-center gap-4">
            <label className="flex h-[66px] min-w-[120px] items-center justify-center rounded-[33px] bg-raised px-4 shadow-[0_0_0_2px_var(--cc-focus)]">
              <span className="sr-only">Grams to log</span>
              <input
                inputMode="decimal"
                enterKeyHint="done"
                value={logAmount}
                placeholder="0"
                onChange={(e) => setLogAmount(cleanTyped(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && void log()}
                className="border-0 bg-transparent p-0 text-right text-[44px] font-light tracking-[-0.04em] outline-none tnum placeholder:text-ink3"
                style={{ width: `${Math.max(1, logAmount.length) * 0.58 + 0.1}em` }}
              />
              <span className="pl-1.5 text-[18px] text-ink2">g</span>
            </label>
            <span className="min-w-0">
              <span className="block text-[26px] font-light tnum">
                {logPreview?.energy_kj == null ? '–' : int(energyIn(logPreview.energy_kj, unit))} <span className="text-sm text-ink2">{u}</span>
              </span>
              {logPreview && (
                <span className="block text-xs text-ink2 tnum">
                  {logPreview.protein_g == null ? '–' : fmtGrams(logPreview.protein_g)} g protein · {logPreview.sat_fat_g == null ? '–' : fmtGrams(logPreview.sat_fat_g)} g sat fat
                </span>
              )}
            </span>
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <Chip key={c.label} selected={logG != null && Math.abs(logG - c.g) < 0.5} onClick={() => setLogAmount(amountString(c.g))}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}
        </section>
        <Notice>{notice}</Notice>
        <Notice tone="warn">{error}</Notice>
      </div>

      <Dock>
        <DockButton
          onClick={async () => {
            const m = await save();
            if (m) setNotice('Saved.');
          }}
          disabled={busy}
        >
          Save meal
        </DockButton>
        <DockButton primary onClick={log} disabled={busy || !logG || !ings.length}>
          {logG ? `Log ${int(logG)} g` : 'Log'}
        </DockButton>
      </Dock>

      <IngredientSearch open={searching} onClose={() => setSearching(false)} onPick={(f) => { setSearching(false); addIngredient(f); }} />
    </main>
  );
}

function IngredientSearch({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (f: Food) => void }) {
  const [q, setQ] = useState('');
  const search = useFoodSearch(q, 20, open);
  const results = search.results ?? [];
  const busy = search.searching;
  return (
    <Sheet open={open} onClose={onClose} label="Add an ingredient">
      <div className="flex flex-col gap-3 pb-2">
        <h2 className="pt-1 text-center text-[17px] font-semibold">Add an ingredient</h2>
        <label className="flex h-12 items-center gap-2.5 rounded-[24px] bg-raised px-4">
          <Icon name="search" size={18} className="text-ink2" />
          <span className="sr-only">Search foods</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search foods" className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none" />
          {busy && <Spinner />}
        </label>
        <div className="max-h-[50dvh] overflow-y-auto rounded-card bg-raised px-4 py-1">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={async () => onPick(await getFood(r.id))}
              className="flex min-h-12 w-full flex-col justify-center border-0 border-t border-separator bg-transparent py-2 text-left first:border-t-0"
            >
              <span className="line-clamp-2 text-[15px] leading-snug">{r.display_name ?? r.name}</span>
              <span className="text-[12px] text-ink2">{[r.brand, SOURCE_TAG[r.source]].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
          {!results.length && <p className="py-3 text-[14px] text-ink2">Type to search.</p>}
        </div>
      </div>
    </Sheet>
  );
}
