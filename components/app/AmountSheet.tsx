'use client';

// The amount sheet: every flow that lands on a single food or meal opens it.
// Choosing a food opens the amount field with the keypad up, in the food's natural unit: your last
// amount, a regular café cup, one slice or one medium, ml for drinks, else grams. Typing a number
// and tapping Save is the whole job. The unit beside the number switches to any unit the food has
// (g, ml, cup, tbsp, tsp, its household measures, typical sizes, serve, pack); grams stay the truth.

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { targetState } from '@/design/components/TargetBar';
import {
  amountString,
  buildChips,
  cleanTyped,
  convertAmount,
  GRAMS,
  mealPer100,
  measureChipLabel,
  naturalStart,
  parseTyped,
  unitGrams,
  unitOptions,
  type AmountChip,
  type AmountUnit,
} from '@/lib/amount';
import { DEFAULT_MEAL_BOUNDARIES, localDate, localTime, MEAL_LABEL, MEAL_ORDER, mealForTime, zonedToUtc, type Meal } from '@/lib/dates';
import { getFood, getMeasures, getStats, mealIngredients, saveMeal } from '@/lib/data';
import { energyIn, energyText, int, nutrientText, saltText } from '@/lib/format';
import { removeEntries, saveEntries, saveEntryEdit } from '@/lib/logging';
import { NUTRIENTS, scale, type Per100 } from '@/lib/nutrients';
import type { FoodSource } from '@/lib/sources/types';
import { SOURCE_TAG, type Food, type FoodStats, type IngredientAdjustment, type LogEntry, type LogMethod, type MealIngredient } from '@/lib/types';
import { Button, Chip, cx, Field, Icon, Notice, RoundButton, Sheet } from '../ui';
import { useApp, useDay } from './AppProvider';

export type AmountRequest =
  | {
      kind: 'food';
      foodId: string;
      /** What's already known, so the sheet shows a name and focuses the field before the food loads. */
      preview?: { name: string; source: FoodSource; is_liquid?: boolean };
      food?: Food;
      prefill?: { amount?: number | null; unit?: 'g' | 'ml' | null; count?: number | null };
      method: LogMethod;
      /** Local date to log on. Defaults to today. */
      date?: string;
      isEstimate?: boolean;
      /** Where to go after saving. Defaults to that day on Today. */
      afterSave?: 'today' | 'stay';
      /** Closed without saving (the scanner resumes). */
      onCancel?: () => void;
    }
  | { kind: 'edit'; entry: LogEntry }
  | {
      /** Choose an amount without logging (meal editor ingredients, meal confirm rows). */
      kind: 'pick';
      foodId: string;
      preview?: { name: string; source: FoodSource; is_liquid?: boolean };
      food?: Food;
      initialGrams?: number | null;
      saveLabel?: string;
      onPick: (r: { grams: number; amount: number; unit: AmountUnit['kind']; measure: string | null; estimate: boolean; food: Food }) => void;
    };

const TILE_ORDER = NUTRIENTS;

/** The unit an entry was logged in, with the grams per unit it was logged with. */
function entryUnit(e: LogEntry): AmountUnit {
  const per = e.entered_amount > 0 ? e.grams / e.entered_amount : 1;
  if (e.entered_unit === 'measure') return { kind: 'measure', label: e.entered_measure ?? 'serve', grams: per, hint: null, estimate: e.is_estimate, countable: true };
  if (e.entered_unit === 'ml') return { kind: 'ml', label: 'ml', grams: per, hint: null, estimate: e.is_estimate, countable: false };
  return GRAMS;
}

const sameUnit = (a: AmountUnit, b: AmountUnit) => a.kind === b.kind && a.label === b.label;

export function AmountSheet({ request, onClose }: { request: AmountRequest; onClose: () => void }) {
  const cancel = () => {
    if (request.kind === 'food') request.onCancel?.();
    onClose();
  };
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const tz = app.profile.time_zone;
  const unitPref = app.profile.energy_unit;
  const boundaries = app.profile.meal_boundaries ?? DEFAULT_MEAL_BOUNDARIES;
  const edit = request.kind === 'edit' ? request.entry : null;
  const foodId = request.kind === 'edit' ? request.entry.food_id : request.foodId;

  const [food, setFood] = useState<Food | null>(request.kind !== 'edit' ? (request.food ?? null) : null);
  const [units, setUnits] = useState<AmountUnit[]>(() => (edit ? [GRAMS, entryUnit(edit)].filter((u, i, a) => a.findIndex((x) => sameUnit(x, u)) === i) : [GRAMS]));
  const [stats, setStats] = useState<FoodStats | null>(null);
  const [ingredients, setIngredients] = useState<MealIngredient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // When and which meal. Time defaults to now and meal to time of day; changing them is never required.
  const date = edit ? localDate(tz, new Date(edit.eaten_at)) : request.kind === 'food' ? (request.date ?? app.today) : app.today;
  const [when, setWhen] = useState(() => ({
    date,
    time: edit ? localTime(tz, new Date(edit.eaten_at)) : localTime(tz),
    meal: (edit?.meal ?? mealForTime(localTime(tz), boundaries)) as Meal,
  }));
  const [editingWhen, setEditingWhen] = useState(false);

  // The amount field. Its unit settles once the food loads (naturalStart).
  const [unit, setUnit] = useState<AmountUnit>(() =>
    edit
      ? entryUnit(edit)
      : request.kind === 'food' && request.prefill?.unit === 'ml'
        ? { kind: 'ml', label: 'ml', grams: 1, hint: null, estimate: true, countable: false }
        : GRAMS,
  );
  // Whether you typed the number. Switching unit keeps a number you typed (you meant it in the other
  // unit) and converts one you didn't (a prefill or a chip).
  const [touched, setTouched] = useState(() => request.kind === 'food' && !!request.prefill?.amount);
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState(() => {
    if (edit) return amountString(edit.entered_amount);
    if (request.kind === 'pick' && request.initialGrams) return amountString(request.initialGrams);
    if (request.kind === 'food' && request.prefill?.amount) return amountString(request.prefill.amount);
    return '';
  });
  const [prefilled, setPrefilled] = useState(false);
  const [chipCounts, setChipCounts] = useState<Record<string, number>>({});
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Meals: "Adjust ingredients" changes today's copy of the recipe, for this log only.
  const [adjusting, setAdjusting] = useState(false);
  const [adjusted, setAdjusted] = useState<IngredientAdjustment | null>(edit?.ingredient_adjustments ?? null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { day } = useDay(when.date);

  // Load the food, its measures and your last amount.
  useEffect(() => {
    if (!foodId) return;
    let live = true;
    const fx = app.fixtures?.foods[foodId];
    Promise.all(
      fx
        ? [Promise.resolve(fx.food), Promise.resolve(fx.measures), Promise.resolve(fx.stats)]
        : [food ? Promise.resolve(food) : getFood(foodId), getMeasures(foodId), getStats(foodId)],
    )
      .then(async ([f, m, s]) => {
        if (!live) return;
        setFood(f);
        setStats(s);
        const options = unitOptions(f, m);
        if (edit) {
          // Keep the unit and grams-per-unit the entry was logged with.
          const own = entryUnit(edit);
          setUnits([...options.filter((u) => !sameUnit(u, own)), own].sort((a, b) => options.findIndex((u) => sameUnit(u, a)) - options.findIndex((u) => sameUnit(u, b))));
        } else {
          setUnits(options);
        }
        if (f.source === 'meal') setIngredients(fx?.ingredients ?? (await mealIngredients(f.id)));
        // Start in the food's natural unit; a prefilled amount is fully selected, so typing replaces it.
        if (!edit && (request.kind === 'food' || (request.kind === 'pick' && !request.initialGrams))) {
          const start = naturalStart(f, options, s, request.kind === 'food' ? request.prefill : undefined);
          setUnit(start.unit);
          if (start.amount != null) setTyped(amountString(start.amount));
          if (start.fromLast) setActiveChip('last');
          else if (start.unit.kind === 'measure' && start.amount === 1) setActiveChip(`u:${start.unit.label}`);
          setPrefilled(start.amount != null && !(request.kind === 'food' && request.prefill?.amount));
        }
      })
      .catch((e: Error) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
    // Load once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodId]);

  // Focus the field straight away, keypad up.
  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (prefilled) requestAnimationFrame(() => inputRef.current?.select());
  }, [prefilled]);

  const name = edit?.food_name_snapshot ?? food?.display_name ?? food?.name ?? (request.kind !== 'edit' ? request.preview?.name : '') ?? '';
  const source: FoodSource | null = food?.source ?? (request.kind !== 'edit' ? (request.preview?.source ?? null) : null);
  const isMeal = source === 'meal';

  const amount = parseTyped(typed);
  const gramsNow = amount == null ? null : unitGrams(amount, unit);

  // Per-100 g values this entry snapshots. Editing recalculates from the snapshot, never the food.
  const per100: Per100 | null = useMemo(() => {
    if (adjusted && ingredients) {
      const byId = new Map(ingredients.map((i) => [i.ingredient_food_id, i.food]));
      const rows = adjusted.ingredients.map((i) => ({ per100: byId.get(i.food_id)!, grams: i.grams })).filter((r) => r.per100);
      const raw = ingredients.reduce((s, i) => s + i.grams, 0);
      return mealPer100(rows, { cookedWeight: food?.cooked_weight_g ?? null, originalRawSum: raw }).per100;
    }
    if (edit) return edit.per100_snapshot;
    return food;
  }, [adjusted, ingredients, edit, food]);

  const chips = useMemo(() => (food ? buildChips(food, units, stats) : []), [food, units, stats]);
  const preview = per100 && gramsNow != null ? scale(per100, gramsNow) : null;

  // Today's totals without this entry, for the bars on each tile.
  const baseTotals = useMemo(() => {
    if (!day) return null;
    const v = { ...day.totals.values };
    if (edit) {
      const own = scale(edit.per100_snapshot, edit.grams);
      for (const k of Object.keys(v) as (keyof Per100)[]) if (v[k] != null && own[k] != null) v[k] = (v[k] as number) - (own[k] as number);
    }
    return v;
  }, [day, edit]);

  function choose(chip: AmountChip) {
    const n = chip.kind === 'measure' && activeChip === chip.key ? (chipCounts[chip.key] ?? 1) + 1 : 1;
    setChipCounts({ [chip.key]: n });
    setActiveChip(chip.key);
    setUnit(chip.unit);
    setTyped(amountString(chip.kind === 'measure' ? n : chip.amount));
    setTouched(false);
    setPrefilled(false);
    inputRef.current?.focus();
  }

  function onType(v: string) {
    setTyped(cleanTyped(v));
    setActiveChip(null);
    setChipCounts({});
    setPrefilled(false);
    setTouched(true);
  }

  // A number you typed is kept (you meant it in the new unit); a prefilled one is converted.
  function pickUnit(u: AmountUnit) {
    setPicking(false);
    if (!sameUnit(u, unit)) {
      if (amount != null && !touched) setTyped(amountString(convertAmount(amount, unit, u)));
      else if (amount == null && u.countable) setTyped('1');
      setUnit(u);
      setActiveChip(null);
      setChipCounts({});
    }
    inputRef.current?.focus();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (saving) return;
    if (gramsNow == null || !(gramsNow > 0)) {
      setError('Type an amount first.');
      inputRef.current?.focus();
      return;
    }
    if (app.fixtures) {
      // The /dev preview has no database: show that Save worked and close.
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (request.kind === 'pick') {
        if (!food) throw new Error('Still loading that food.');
        request.onPick({ grams: gramsNow, amount: amount!, unit: unit.kind, measure: unit.kind === 'measure' ? unit.label : null, estimate: unit.estimate, food });
        onClose();
        return;
      }
      if (!per100) throw new Error('Still loading that food.');
      const eatenAt = zonedToUtc(when.date, when.time, tz).toISOString();
      const estimate = unit.estimate || (request.kind === 'food' && !!request.isEstimate);
      const entered = { entered_amount: amount!, entered_unit: unit.kind, entered_measure: unit.kind === 'measure' ? unit.label : null };
      if (edit) {
        await saveEntryEdit(
          edit.id,
          {
            grams: gramsNow,
            ...entered,
            meal: when.meal,
            eaten_at: eatenAt,
            per100_snapshot: per100,
            ingredient_adjustments: adjusted,
            is_estimate: unit.kind === 'g' ? false : estimate,
          },
          tz,
        );
        onClose();
        return;
      }
      if (request.kind !== 'food') return;
      await saveEntries(
        [
          {
            eaten_at: eatenAt,
            meal: when.meal,
            food_id: food!.id,
            food_name_snapshot: name,
            source_snapshot: SOURCE_TAG[food!.source],
            grams: gramsNow,
            ...entered,
            per100_snapshot: per100,
            ingredient_adjustments: adjusted,
            is_estimate: estimate,
            method: isMeal && request.method === 'search' ? 'meal' : request.method,
          },
        ],
        tz,
      );
      onClose();
      if (request.afterSave !== 'stay') {
        const to = when.date === app.today ? '/' : `/?d=${when.date}`;
        if (pathname !== '/') router.push(to);
        else if (when.date !== app.today) router.push(to);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!edit) return;
    setSaving(true);
    try {
      await removeEntries([edit.id]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete.");
      setSaving(false);
    }
  }

  const energyNow = preview?.energy_kj ?? null;
  // The figure is 84 px as designed, shrinking for long amounts so the capsule fits a phone.
  const figureSize = typed.length <= 3 ? 84 : typed.length === 4 ? 70 : 58;
  const width = `${Math.max(1, typed.length) * 0.56 + 0.06}em`;

  return (
    <Sheet open onClose={cancel} label={`Amount for ${name}`}>
      {adjusting && ingredients ? (
        <AdjustIngredients
          ingredients={ingredients}
          value={adjusted}
          onDone={(a) => {
            setAdjusted(a);
            setAdjusting(false);
          }}
          onCancel={() => setAdjusting(false)}
          mealName={name}
        />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <RoundButton icon="close" label="Close" onClick={cancel} size={32} />
            <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 text-center">
              {food && request.kind !== 'pick' && food.source !== 'meal' ? (
                <button
                  type="button"
                  onClick={() => {
                    cancel();
                    router.push(`/foods/${food.id}`);
                  }}
                  className="max-w-full border-0 bg-transparent p-0 text-[18px] font-semibold text-ink"
                  aria-label={`${name}: details, measures and edit`}
                >
                  <span className="line-clamp-2 leading-tight">{name}</span>
                </button>
              ) : (
                <span className="line-clamp-2 max-w-full text-[18px] font-semibold leading-tight">{name || '…'}</span>
              )}
              <span className="text-xs text-ink2">
                {source ? (edit?.source_snapshot ?? SOURCE_TAG[source]) : (edit?.source_snapshot ?? '')}
                {request.kind !== 'pick' && (
                  <>
                    {' · '}
                    <button type="button" onClick={() => setEditingWhen((v) => !v)} className="border-0 bg-transparent p-0 font-semibold text-accent">
                      {MEAL_LABEL[when.meal]}, {when.time}
                      {when.date !== app.today ? `, ${new Date(`${when.date}T12:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : ''}
                    </button>
                  </>
                )}
              </span>
            </div>
            <span className="w-11" />
          </div>

          {editingWhen && request.kind !== 'pick' && (
            <WhenEditor value={when} onChange={(w) => setWhen(w)} onDone={() => setEditingWhen(false)} />
          )}

          <div className="flex flex-col items-center gap-0.5 pb-0.5 pt-1.5">
            <label htmlFor="amount-field" className="sr-only">
              Amount in {unit.kind === 'g' ? 'grams' : unit.kind === 'ml' ? 'millilitres' : unit.label}
            </label>
            <div
              className="flex h-[104px] min-w-[220px] max-w-full items-center justify-center rounded-[52px] bg-raised px-7"
              style={{ boxShadow: '0 0 0 2.5px var(--cc-focus), 0 0 0 8px var(--cc-focus-glow)' }}
              onClick={() => inputRef.current?.focus()}
            >
              <input
                id="amount-field"
                ref={inputRef}
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={typed}
                onChange={(e) => onType(e.target.value)}
                onFocus={(e) => prefilled && e.currentTarget.select()}
                placeholder="0"
                className="border-0 bg-transparent p-0 text-right font-light leading-none tracking-[-0.05em] text-ink outline-none tnum placeholder:text-ink3"
                style={{ width, fontSize: figureSize, caretColor: 'var(--cc-focus)' }}
              />
              {units.length > 1 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPicking((v) => !v);
                  }}
                  aria-expanded={picking}
                  aria-label={`Unit: ${unit.label}. Change unit`}
                  className={cx(
                    'ml-2.5 flex min-w-0 max-w-[160px] items-center gap-1 rounded-full border-0 bg-surface/60 px-2.5 py-1 text-ink2',
                    unit.label.length <= 3 ? 'text-[30px]' : 'text-[20px] leading-tight',
                  )}
                >
                  <span className="truncate">{unit.label}</span>
                  <Icon name="chevronDown" size={14} stroke={2.2} />
                </button>
              ) : (
                <span className="pl-2.5 text-[30px] text-ink2">g</span>
              )}
            </div>
            <span className="pt-2 text-sm text-ink2 tnum">
              {energyNow == null ? (per100 && per100.energy_kj == null ? 'Energy unknown' : ' ') : energyText(energyNow, unitPref)}
              {unit.kind !== 'g' && gramsNow != null && ` · ${int(gramsNow)} g`}
              {unit.kind !== 'g' && unit.estimate && (unit.countable ? ', typical size' : ', assumed 1 g per ml')}
            </span>
          </div>

          {picking && (
            <div role="group" aria-label="Units" className="flex flex-wrap justify-center gap-2">
              {units.map((u) => (
                <Chip key={`${u.kind}:${u.label}`} selected={sameUnit(u, unit)} onClick={() => pickUnit(u)}>
                  {u.label}
                  {u.hint && <span className="font-normal opacity-70"> · {u.hint}</span>}
                </Chip>
              ))}
            </div>
          )}

          {!picking && chips.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {chips.map((c) => (
                <Chip key={c.key} selected={activeChip === c.key} onClick={() => choose(c)}>
                  {measureChipLabel(c, activeChip === c.key ? (chipCounts[c.key] ?? 1) : 1)}
                </Chip>
              ))}
            </div>
          )}

          {isMeal && ingredients && ingredients.length > 0 && request.kind !== 'pick' && (
            <div className="-my-1 flex justify-center">
              <Button variant="link" onClick={() => setAdjusting(true)}>
                {adjusted ? `Ingredients adjusted · ${adjusted.ingredients.length} of ${ingredients.length}` : 'Adjust ingredients'}
              </Button>
            </div>
          )}

          <div aria-label={`Nutrition for ${typed || 0} ${unit.label}`} className="grid grid-cols-3 gap-1.5">
            {TILE_ORDER.map((info) => {
              const v = preview ? preview[info.key] : null;
              const row = info.key === 'energy_kj' ? null : day?.targetRows.find((r) => r.info.key === info.key);
              const energyTarget = info.key === 'energy_kj' && day?.ring ? day.ring.target : null;
              const todayRaw = baseTotals ? baseTotals[info.key] : null;
              const todayVal = info.key === 'energy_kj' ? (todayRaw == null ? 0 : energyIn(todayRaw, unitPref)) : (todayRaw ?? 0);
              const thisVal = v == null ? 0 : info.key === 'energy_kj' ? energyIn(v, unitPref) : v;
              return (
                <div key={info.key} className="flex h-[60px] flex-col gap-0.5 rounded-tile bg-raised px-3 py-[7px]">
                  <span className="whitespace-nowrap text-[11px] leading-[14px] text-ink2">{info.label === 'Dietary fibre' ? 'Fibre' : info.label}</span>
                  <span className="whitespace-nowrap text-base font-medium leading-5 tnum">
                    {per100 && per100[info.key] == null ? '–' : nutrientText(info.key, v ?? 0, unitPref)}
                  </span>
                  {info.key === 'sodium_mg' && v != null ? (
                    <span className="text-[10px] leading-3 text-ink2">({saltText(v)})</span>
                  ) : energyTarget ? (
                    <TileBar today={todayVal} add={thisVal} max={energyTarget} colour="var(--cc-ink2)" />
                  ) : row ? (
                    <TileBar
                      today={todayVal}
                      add={thisVal}
                      max={row.direction === 'range' ? row.max * 1.2 : row.max}
                      colour={row.direction === 'noMoreThan' ? undefined : `var(--cc-${info.colour ?? 'ink2'})`}
                      limit={row.direction === 'noMoreThan' ? row.max : undefined}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <Notice tone="warn">{error ?? loadError}</Notice>

          <Button type="submit" disabled={saving}>
            {request.kind === 'pick' ? (request.saveLabel ?? 'Done') : saving ? 'Saving…' : 'Save'}
          </Button>
          {edit && (
            <div className="-mt-1 flex justify-center">
              <Button variant="warnLink" onClick={onDelete} disabled={saving}>
                Delete this entry
              </Button>
            </div>
          )}
        </form>
      )}
    </Sheet>
  );
}

/** A thin bar: today so far, then this amount in ink. "No more than" targets turn the warning tone near and over the limit. */
function TileBar({ today, add, max, colour, limit }: { today: number; add: number; max: number; colour?: string; limit?: number }) {
  if (!(max > 0)) return null;
  const t = Math.min(1, Math.max(0, today) / max);
  const a = Math.min(1 - t, Math.max(0, add) / max);
  let style: React.CSSProperties = { width: `${t * 100}%`, background: colour };
  let cls = '';
  if (limit != null) {
    const st = targetState({ value: today + add, direction: 'noMoreThan', max: limit, unit: 'g' });
    if (st.tone === 'over') cls = 'cc-hatch';
    style = { width: `${t * 100}%`, background: st.tone === 'near' ? 'var(--cc-warn)' : st.tone === 'over' ? undefined : 'var(--cc-ink3)', opacity: st.tone === 'near' ? 0.5 : 1 };
  }
  return (
    <div className="mt-[3px] flex h-1 overflow-hidden rounded-sm bg-track" aria-hidden="true">
      <div className={cls} style={style} />
      <div style={{ width: `${a * 100}%`, background: 'var(--cc-ink)' }} />
    </div>
  );
}

export function WhenEditor({ value, onChange, onDone }: {
  value: { date: string; time: string; meal: Meal };
  onChange: (v: { date: string; time: string; meal: Meal }) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card bg-raised p-3">
      <div className="grid grid-cols-4 gap-1">
        {MEAL_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ ...value, meal: m })}
            className={cx('press h-10 rounded-[20px] border-0 text-sm font-semibold', value.meal === m ? 'bg-primary text-on-primary' : 'bg-surface text-ink')}
          >
            {MEAL_LABEL[m]}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label="Date"
          value={value.date}
          onChange={(e) => e.target.value && onChange({ ...value, date: e.target.value })}
          className="h-11 min-w-0 flex-1 rounded-[22px] border-0 bg-surface px-4 text-[15px] tnum"
        />
        <input
          type="time"
          aria-label="Time"
          value={value.time}
          onChange={(e) => e.target.value && onChange({ ...value, time: e.target.value })}
          className="h-11 w-[120px] rounded-[22px] border-0 bg-surface px-4 text-[15px] tnum"
        />
        <Button size="sm" variant="secondary" onClick={onDone} className="bg-surface">
          Done
        </Button>
      </div>
    </div>
  );
}

/** Today's copy of a meal's recipe: drop or change an item for this log only. */
function AdjustIngredients({ ingredients, value, onDone, onCancel, mealName }: {
  ingredients: MealIngredient[];
  value: IngredientAdjustment | null;
  onDone: (a: IngredientAdjustment | null) => void;
  onCancel: () => void;
  mealName: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(() =>
    ingredients.map((i) => {
      const adj = value?.ingredients.find((a) => a.food_id === i.ingredient_food_id);
      return { food_id: i.ingredient_food_id, name: i.food.display_name ?? i.food.name, grams: adj ? adj.grams : i.grams, on: value ? !!adj : true };
    }),
  );
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = rows.some((r, i) => !r.on || r.grams !== ingredients[i].grams);
  const result = (): IngredientAdjustment | null =>
    changed
      ? {
          ingredients: rows.filter((r) => r.on).map(({ food_id, name, grams }) => ({ food_id, name, grams })),
          removed: rows.filter((r) => !r.on).map((r) => r.food_id),
        }
      : null;

  // Inline naming rather than window.prompt, which is unreliable inside the Android WebView.
  async function saveAsNew() {
    const name = naming?.trim();
    if (!name) return;
    setSaving(true);
    try {
      const meal = await saveMeal({
        name,
        serves: null,
        cooked_weight_g: null,
        ingredients: rows.filter((r) => r.on && r.grams > 0).map((r) => ({ food_id: r.food_id, grams: r.grams })),
      });
      onDone(result());
      router.push(`/meals/${meal.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the meal.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div className="flex items-center justify-between">
        <RoundButton icon="back" label="Back" onClick={onCancel} size={32} />
        <span className="text-[18px] font-semibold">Adjust ingredients</span>
        <span className="w-11" />
      </div>
      <p className="px-1 text-center text-[14px] text-ink2">For this log only. The saved meal stays as it is.</p>
      <div className="rounded-card bg-raised px-4 py-1">
        {rows.map((r, i) => (
          <div key={r.food_id} className={cx('flex min-h-[52px] items-center gap-2 border-t border-separator first:border-t-0', !r.on && 'opacity-50')}>
            <span className={cx('line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug', !r.on && 'line-through')}>{r.name}</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={`${r.name}, grams`}
              value={amountString(r.grams)}
              disabled={!r.on}
              onChange={(e) => {
                const n = parseTyped(cleanTyped(e.target.value));
                setRows((rs) => rs.map((x, j) => (j === i ? { ...x, grams: n ?? 0 } : x)));
              }}
              className="h-10 w-[74px] rounded-[20px] border-0 bg-surface text-center text-[16px] font-medium tnum"
            />
            <span className="text-[13px] text-ink2">g</span>
            <button
              type="button"
              aria-label={r.on ? `Leave out ${r.name}` : `Put back ${r.name}`}
              onClick={() => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
              className="flex h-11 w-11 items-center justify-center border-0 bg-transparent text-ink2"
            >
              <Icon name={r.on ? 'remove' : 'add'} size={20} />
            </button>
          </div>
        ))}
      </div>
      <Notice tone="warn">{error}</Notice>
      {naming != null ? (
        <div className="flex items-end gap-2">
          <Field label="Name for the new meal" value={naming} onChange={(e) => setNaming(e.target.value)} className="flex-1" autoFocus />
          <Button size="md" variant="secondary" onClick={saveAsNew} disabled={saving || !naming.trim()}>
            Save
          </Button>
        </div>
      ) : (
        <>
          <Button onClick={() => onDone(result())}>Use for this log</Button>
          <div className="flex justify-center">
            <Button variant="link" onClick={() => setNaming(`${mealName}, adjusted`)} disabled={!changed}>
              Save as new meal
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
