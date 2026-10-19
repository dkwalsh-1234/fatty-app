'use client';

// Meal confirm (design 05): one row per item with the matched food (swap for another candidate
// or search), grams (tap for the amount sheet) and remove. Suggested hidden fats start unticked.
// Save logs every row as its own entry, linked to the photo. Nothing is saved without this screen.
// Items search couldn't match have already been through the AI fallback (lib/ai/resolve.ts); a
// mixed drink or dish may arrive split into parts. An unmatched item can take an AI estimate (Q5).

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { WhenEditor } from '@/components/app/AmountSheet';
import { BackButton, Button, cx, Dock, DockButton, Field, Icon, MacroDot, Notice, Screen, Sheet, Spinner } from '@/components/ui';
import { signedPhotoUrl } from '@/lib/camera';
import { MEAL_PHOTO_BUCKET } from '@/lib/config';
import { DEFAULT_MEAL_BOUNDARIES, localTime, MEAL_LABEL, mealForTime, zonedToUtc, type Meal } from '@/lib/dates';
import { PROVIDER_BY_ID } from '@/lib/ai/config';
import { aiEstimate, AiCallError } from '@/lib/ai-fallback';
import { getFood, saveMeal, type SearchResult } from '@/lib/data';
import { useFoodSearch } from '@/lib/useFoodSearch';
import type { Candidate, Draft } from '@/lib/drafts';
import { energyText, grams as fmtGrams, int, saltText } from '@/lib/format';
import { saveEntries } from '@/lib/logging';
import { sumEntries, toPer100, type Per100 } from '@/lib/nutrients';
import { supabase } from '@/lib/supabase/browser';
import { SOURCE_TAG, type Food } from '@/lib/types';

export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <Confirm />
    </Suspense>
  );
}

interface Row {
  key: string;
  label: string;
  query: string;
  candidates: Candidate[];
  /** The chosen food: a candidate, or one picked by search. */
  food: { id: string; name: string; source: string; per100: Per100; is_liquid: boolean } | null;
  grams: number | null;
  estimate: boolean;
  confidence: 'low' | 'medium' | 'high' | null;
  suggested: boolean;
  on: boolean;
  note: string | null;
  /** The AI split a mixed drink or dish into parts: what it was split from. */
  splitFrom: string | null;
}

const fromCandidate = (c: Candidate): NonNullable<Row['food']> => ({
  id: c.id,
  name: c.display_name ?? c.name,
  source: c.source,
  per100: toPer100(c as unknown as Record<string, unknown>),
  is_liquid: c.is_liquid,
});

function Confirm() {
  const app = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const photoId = params.get('photo');
  const textKey = params.get('text');
  const date = params.get('d') ?? app.today;
  const tz = app.profile.time_zone;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState(() => ({ date, time: localTime(tz), meal: mealForTime(localTime(tz), app.profile.meal_boundaries ?? DEFAULT_MEAL_BOUNDARIES) as Meal }));
  const [editingWhen, setEditingWhen] = useState(false);
  const [swapping, setSwapping] = useState<Row | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The draft comes from the step before, or from the stored AI response (never re-sent to AI).
  useEffect(() => {
    (async () => {
      const key = photoId ? `fatty:draft:${photoId}` : textKey ? `fatty:draft:text:${textKey}` : null;
      let d: Draft | null = key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
      if (photoId) {
        const { data } = await supabase().from('meal_photos').select('storage_path, ai_response').eq('id', photoId).maybeSingle();
        if (data) {
          d ??= (data.ai_response?.draft as Draft) ?? null;
          void signedPhotoUrl(MEAL_PHOTO_BUCKET, data.storage_path).then(setPhotoUrl);
        }
      }
      if (!d) throw new Error('This meal has expired. Start again from Photo or Type.');
      setDraft(d);
      setRows(
        d.items.map((i) => ({
          key: i.key,
          label: i.label,
          query: i.query,
          candidates: i.candidates,
          food: i.candidates[0] ? fromCandidate(i.candidates[0]) : null,
          grams: i.grams,
          estimate: i.estimate,
          confidence: i.confidence,
          suggested: i.suggested,
          on: !i.suggested,
          note: i.note,
          splitFrom: i.splitFrom ?? null,
        })),
      );
    })().catch((e: Error) => setError(e.message));
  }, [photoId, textKey]);

  // Matched rows are foods; unmatched ones still need a food and are never counted or saved.
  const found = rows.filter((r) => !r.suggested && r.food);
  const needsFood = rows.filter((r) => !r.suggested && !r.food);
  const suggestions = rows.filter((r) => r.suggested);
  const active = rows.filter((r) => r.on && r.food && r.grams);
  const needsAmount = rows.filter((r) => r.on && r.food && !r.grams);
  const pendingFood = rows.filter((r) => r.on && !r.food).length;
  const canSave = active.length > 0 && needsAmount.length === 0;
  const totals = useMemo(() => sumEntries(active.map((r) => ({ per100: r.food!.per100, grams: r.grams! }))), [active]);
  const totalGrams = active.reduce((s, r) => s + (r.grams ?? 0), 0);
  const unit = app.profile.energy_unit;
  const needsFoodLine = pendingFood > 0 ? `${pendingFood} ${pendingFood === 1 ? 'item needs' : 'items need'} a food` : null;

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function editGrams(r: Row) {
    if (!r.food) return setSwapping(r);
    let food: Food;
    try {
      food = await getFood(r.food.id);
    } catch (e) {
      return setError(e instanceof Error ? e.message : "Couldn't load that food.");
    }
    app.openAmount({
      kind: 'pick',
      foodId: food.id,
      food,
      initialGrams: r.grams,
      saveLabel: 'Done',
      onPick: ({ grams }) => update(r.key, { grams, estimate: false, note: null, on: true }),
    });
  }

  async function save() {
    setError(null);
    // The buttons stay disabled until this holds; each row says what it still needs.
    if (!canSave) return;
    setSaving(true);
    try {
      const eatenAt = zonedToUtc(when.date, when.time, tz).toISOString();
      await saveEntries(
        active.map((r) => ({
          eaten_at: eatenAt,
          meal: when.meal,
          food_id: r.food!.id,
          food_name_snapshot: r.food!.name,
          source_snapshot: SOURCE_TAG[r.food!.source as keyof typeof SOURCE_TAG] ?? null,
          grams: r.grams!,
          entered_amount: r.grams!,
          entered_unit: 'g' as const,
          per100_snapshot: r.food!.per100,
          is_estimate: r.estimate,
          method: draft?.kind === 'photo' ? ('photo' as const) : ('text' as const),
          meal_photo_id: draft?.meal_photo_id ?? null,
        })),
        tz,
      );
      if (textKey) sessionStorage.removeItem(`fatty:draft:text:${textKey}`);
      router.replace(when.date === app.today ? '/' : `/?d=${when.date}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setSaving(false);
    }
  }

  async function saveAsMeal() {
    const name = naming?.trim();
    if (!name || !canSave) return;
    setSaving(true);
    try {
      await saveMeal({ name, serves: null, cooked_weight_g: null, ingredients: active.map((r) => ({ food_id: r.food!.id, grams: r.grams! })) });
      setNotice(`Saved as a meal: ${name}. Tap Save to log it now.`);
      setNaming(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the meal.");
    } finally {
      setSaving(false);
    }
  }

  if (error && !draft) {
    return (
      <Screen dock={false}>
        <div className="flex h-[56px] items-center">
          <BackButton />
        </div>
        <Notice tone="warn">{error}</Notice>
      </Screen>
    );
  }
  if (!draft) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const v = totals.values;
  return (
    <Screen>
      <header className="-mx-1 flex h-14 items-center justify-between">
        <BackButton />
        <span className="text-base font-semibold">Check your meal</span>
        <span className="w-11" />
      </header>
      <div className="flex flex-col gap-3">
        {draft.kind === 'photo' ? (
          <div className="relative flex h-[176px] items-center justify-center overflow-hidden rounded-[28px] bg-photo-placeholder">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photoUrl && <img src={photoUrl} alt="Your meal" className="absolute inset-0 h-full w-full object-cover" />}
            {draft.hint && (
              <div className="absolute inset-x-2.5 bottom-2.5 flex h-[46px] items-center gap-2 rounded-[23px] bg-[rgba(13,47,35,0.78)] pl-[18px] pr-1 text-pine-mint shadow-[0_0_0_1px_rgba(236,247,238,0.10)] backdrop-blur-[20px]">
                <span className="flex-1 truncate text-[15px]">“{draft.hint}”</span>
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-pine-raised text-pine-lime">
                  <Icon name="mic" size={18} />
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-card bg-raised px-5 py-3.5 text-[15px] leading-snug text-ink2">“{draft.text}”</div>
        )}

        {found.length > 0 && (
          <section aria-label="Items found" className="rounded-card bg-surface pb-1.5 pl-5 pr-1.5 pt-1 shadow-[var(--cc-card-shadow)]">
            <div className="flex h-10 items-center pr-3.5">
              <span className="flex-1 text-[17px] font-semibold">Found</span>
              <span className="text-[13px] text-ink2">{found.filter((r) => r.on).length} {found.filter((r) => r.on).length === 1 ? 'item' : 'items'}</span>
            </div>
            {found.map((r) => (
              <div key={r.key} className={cx('flex min-h-14 items-center gap-1.5 border-t border-separator py-1', !r.on && 'opacity-50')}>
                <span className="min-w-0 flex-1">
                  <span className={cx('line-clamp-2 block text-[15px] font-medium leading-snug', !r.on && 'line-through')}>{r.food!.name}</span>
                  {(() => {
                    if (r.on && !r.grams) return <span className="block truncate text-[12px] text-warn-text">Add an amount, or remove this item</span>;
                    const sub = [
                      r.food!.source === 'ai' ? 'AI estimate' : null,
                      r.splitFrom ? `split by AI from “${r.splitFrom}”` : r.food!.name.toLowerCase() !== r.label.toLowerCase() ? `for “${r.label}”` : null,
                      r.note,
                      r.confidence === 'low' ? 'low confidence' : null,
                    ].filter(Boolean);
                    return sub.length ? <span className="block truncate text-[12px] text-ink2">{sub.join(' · ')}</span> : null;
                  })()}
                </span>
                <button
                  type="button"
                  onClick={() => editGrams(r)}
                  aria-label={`${r.food!.name}, ${r.grams ?? 'no'} g. Change amount`}
                  className="press h-[34px] shrink-0 rounded-[17px] border-0 bg-raised px-3.5 text-[15px] font-medium tnum"
                >
                  {r.grams ? `${r.estimate ? '≈ ' : ''}${int(r.grams)} g` : 'Add g'}
                </button>
                <button type="button" onClick={() => setSwapping(r)} aria-label={`Swap ${r.food!.name}`} className="flex h-11 w-10 items-center justify-center border-0 bg-transparent p-0 text-accent">
                  <Icon name="swap" size={20} stroke={1.9} />
                </button>
                <RemoveToggle row={r} onToggle={() => update(r.key, { on: !r.on })} />
              </div>
            ))}
          </section>
        )}

        {needsFood.length > 0 && (
          <section aria-label="Items that need a food" className="rounded-card bg-surface pb-1.5 pl-5 pr-1.5 pt-1 shadow-[var(--cc-card-shadow)]">
            <div className="flex h-10 items-center pr-3.5">
              <span className="flex-1 text-[17px] font-semibold">Needs a food</span>
              <span className="text-[13px] text-ink2">{needsFood.filter((r) => r.on).length}</span>
            </div>
            {needsFood.map((r) => (
              <div key={r.key} className={cx('flex min-h-14 items-center gap-1.5 border-t border-separator py-1.5', !r.on && 'opacity-50')}>
                <span className="min-w-0 flex-1">
                  <span className={cx('line-clamp-2 block text-[15px] font-medium leading-snug', !r.on && 'line-through')}>
                    {r.label} <span className="whitespace-nowrap font-normal text-ink2">· not matched</span>
                  </span>
                  <span className="block text-[12px] leading-snug text-ink2 tnum">
                    {r.grams ? `≈ ${int(r.grams)} g · ` : ''}
                    {r.splitFrom ? 'split by AI · ' : ''}
                    {r.on ? 'Search for a match or remove this item' : 'Removed'}
                  </span>
                </span>
                {r.on && (
                  <button
                    type="button"
                    onClick={() => setSwapping(r)}
                    aria-label={`Search for a food for ${r.label}`}
                    className="press flex h-[34px] shrink-0 items-center gap-1.5 rounded-[17px] border-0 bg-raised px-3 text-[14px] font-semibold text-accent"
                  >
                    <Icon name="search" size={16} stroke={2} />
                    Search
                  </button>
                )}
                <RemoveToggle row={r} onToggle={() => update(r.key, { on: !r.on })} />
              </div>
            ))}
          </section>
        )}

        {suggestions.map((r) => (
          <label key={r.key} className="flex min-h-[62px] items-center gap-3 rounded-card border-[1.5px] border-dashed border-ink3 px-5 py-2">
            <input
              type="checkbox"
              checked={r.on}
              onChange={(e) => update(r.key, { on: e.target.checked })}
              className="h-[22px] w-[22px] shrink-0 accent-[var(--cc-accent)]"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-medium tnum">
                {r.food?.name ?? r.label}
                {r.note ? ` · ${r.note}` : ''} · {r.grams ? `${int(r.grams)} g` : '?'}
              </span>
              <span className="text-xs text-ink2">
                Suggested hidden fat · {!r.food ? 'not matched' : r.on ? 'added' : 'not added'}
              </span>
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (r.food) void editGrams(r);
                else setSwapping(r);
              }}
              className="border-0 bg-transparent text-[14px] font-semibold text-accent"
            >
              {r.food ? 'Amount' : 'Search'}
            </button>
          </label>
        ))}

        {active.length === 0 ? (
          <section aria-label="Total" className="rounded-card bg-surface px-5 py-4 text-[15px] text-ink2 shadow-[var(--cc-card-shadow)]">
            {needsFoodLine ?? 'Nothing ticked yet'}
          </section>
        ) : (
          <section aria-label="Total" className="flex flex-col gap-2.5 rounded-card bg-surface px-5 py-4 shadow-[var(--cc-card-shadow)]">
            <div className="flex items-baseline justify-between">
              <span className="text-[38px] font-light leading-none tracking-[-0.04em] tnum">
                {v.energy_kj == null ? '–' : energyText(v.energy_kj, unit, false)}{' '}
                <span className="text-sm font-normal tracking-normal text-ink2">{unit === 'kj' ? 'kJ' : 'kcal'}</span>
              </span>
              <span className="text-[13px] text-ink2 tnum">
                {int(totalGrams)} g · {active.length} {active.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px]">
              {([['protein', 'Protein', v.protein_g], ['carbs', 'Carbs', v.carbs_g], ['fat', 'Fat', v.fat_g], ['other', 'Fibre', v.fibre_g]] as const).map(([c, label, val]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <MacroDot colour={c} />
                  {label}
                  <span className="font-semibold tnum">{val == null ? '–' : `${fmtGrams(val)} g`}</span>
                </span>
              ))}
            </div>
            <span className="text-xs text-ink2 tnum">
              Saturated {v.sat_fat_g == null ? '–' : `${fmtGrams(v.sat_fat_g)} g`} · trans {v.trans_fat_g == null ? '–' : `${fmtGrams(v.trans_fat_g)} g`} · sugars{' '}
              {v.sugars_g == null ? '–' : `${fmtGrams(v.sugars_g)} g`} · sodium {v.sodium_mg == null ? '–' : `${int(v.sodium_mg)} mg (${saltText(v.sodium_mg)})`}
            </span>
            {Object.values(totals.missing).some((n) => n > 0) && <span className="text-xs text-ink2">“–” means a food has no value for it.</span>}
            {needsFoodLine && <span className="text-[13px] text-ink2">{needsFoodLine}</span>}
          </section>
        )}

        <button type="button" onClick={() => setEditingWhen((x) => !x)} className="flex h-9 items-center gap-1 self-center border-0 bg-transparent px-2 text-sm font-semibold text-accent">
          {MEAL_LABEL[when.meal]} · {when.time}
          <Icon name="chevronDown" size={12} stroke={2.4} />
        </button>
        {editingWhen && <WhenEditor value={when} onChange={setWhen} onDone={() => setEditingWhen(false)} />}

        {naming != null && (
          <div className="flex items-end gap-2">
            <Field label="Name for the meal" value={naming} onChange={(e) => setNaming(e.target.value)} className="flex-1" autoFocus />
            <Button size="md" variant="secondary" onClick={saveAsMeal} disabled={saving || !naming.trim()}>
              Save
            </Button>
          </div>
        )}
        <Notice>{notice}</Notice>
        <Notice tone="warn">{error}</Notice>
      </div>

      <Dock>
        <DockButton onClick={() => setNaming(naming == null ? (draft.hint ?? '') : null)} disabled={saving || !canSave}>
          Save as meal
        </DockButton>
        <DockButton primary onClick={save} disabled={saving || !canSave}>
          {saving ? 'Saving…' : 'Save'}
        </DockButton>
      </Dock>

      <SwapSheet
        key={swapping?.key ?? 'none'}
        row={swapping}
        // The last resort, for an item nothing matched, and only with an AI key.
        estimateWith={swapping && !swapping.food && app.aiKey ? PROVIDER_BY_ID[app.aiKey.provider].name : null}
        onClose={() => setSwapping(null)}
        onPick={(food) => {
          if (!swapping) return;
          update(swapping.key, { food, on: true });
          setSwapping(null);
        }}
      />
    </Screen>
  );
}

function RemoveToggle({ row, onToggle }: { row: Row; onToggle: () => void }) {
  const name = row.food?.name ?? row.label;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={row.on ? `Remove ${name}` : `Put back ${name}`}
      className="flex h-11 w-10 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-ink2"
    >
      <Icon name={row.on ? 'remove' : 'add'} size={20} />
    </button>
  );
}

function SwapSheet({ row, estimateWith, onClose, onPick }: {
  row: Row | null;
  /** Provider name when "Use an AI estimate" is offered. */
  estimateWith: string | null;
  onClose: () => void;
  onPick: (f: NonNullable<Row['food']>) => void;
}) {
  // Keyed by row, so the search box starts with that item's name.
  const [q, setQ] = useState(row?.query ?? '');
  const search = useFoodSearch(q, 12, !!row);
  const results = search.results ?? [];
  const busy = search.searching;
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<{ message: string; settings: boolean } | null>(null);
  const phrase = q.trim() || row?.label || '';
  // Offered once search has nothing better than close spellings.
  const offerEstimate = !!estimateWith && phrase.length >= 2 && !busy && (results.length === 0 || results[0].tier === 3);

  async function estimate() {
    setEstimating(true);
    setEstimateError(null);
    try {
      onPick(fromCandidate(await aiEstimate(phrase)));
    } catch (e) {
      setEstimateError({ message: e instanceof Error ? e.message : "That didn't work.", settings: e instanceof AiCallError && e.settings });
    } finally {
      setEstimating(false);
    }
  }

  async function pickResult(r: SearchResult) {
    const f = await getFood(r.id);
    onPick({ id: f.id, name: f.display_name ?? f.name, source: f.source, per100: f, is_liquid: f.is_liquid });
  }

  return (
    <Sheet open={!!row} onClose={onClose} label="Swap food">
      <div className="flex flex-col gap-3 pb-2">
        <h2 className="pt-1 text-center text-[17px] font-semibold">Which food is it?</h2>
        {row && row.candidates.length > 0 && (
          <div className="rounded-card bg-raised px-4 py-1">
            {row.candidates.map((c) => (
              <button key={c.id} type="button" onClick={() => onPick(fromCandidate(c))} className="flex min-h-12 w-full items-center justify-between gap-3 border-0 border-t border-separator bg-transparent py-2 text-left first:border-t-0">
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{c.display_name ?? c.name}</span>
                  <span className="block text-[12px] text-ink2">{SOURCE_TAG[c.source as keyof typeof SOURCE_TAG]}</span>
                </span>
                {row.food?.id === c.id && <Icon name="check" size={18} className="text-accent" />}
              </button>
            ))}
          </div>
        )}
        <label className="flex h-12 items-center gap-2.5 rounded-[24px] bg-raised px-4">
          <Icon name="search" size={18} className="text-ink2" />
          <span className="sr-only">Search for another food</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for another" className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none" />
          {busy && <Spinner />}
        </label>
        {results.length > 0 && (
          <div className="max-h-[40dvh] overflow-y-auto rounded-card bg-raised px-4 py-1">
            {results.map((r) => (
              <button key={r.id} type="button" onClick={() => pickResult(r)} className="flex min-h-12 w-full flex-col justify-center border-0 border-t border-separator bg-transparent py-2 text-left first:border-t-0">
                <span className="truncate text-[15px]">{r.display_name ?? r.name}</span>
                <span className="text-[12px] text-ink2">{[r.brand, SOURCE_TAG[r.source]].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
        {offerEstimate && (
          <div className="rounded-card bg-raised px-4 py-2">
            <button type="button" onClick={estimate} disabled={estimating} className="flex min-h-11 w-full items-center gap-2 border-0 bg-transparent p-0 text-left text-[16px] font-semibold text-accent">
              {estimating ? 'Estimating…' : 'Use an AI estimate'}
              {estimating && <Spinner label="Estimating" />}
            </button>
            <p className="pb-1 text-[12px] leading-snug text-ink2">
              {estimateWith} estimates the values for “{phrase}”. They&apos;re marked AI estimate wherever they&apos;re counted.
            </p>
          </div>
        )}
        <Notice tone="warn">
          {estimateError && (
            <>
              {estimateError.message}
              {estimateError.settings && (
                <>
                  {' '}
                  <a href="/settings#ai" className="font-semibold text-accent">
                    Settings
                  </a>
                </>
              )}
            </>
          )}
        </Notice>
      </div>
    </Sheet>
  );
}
