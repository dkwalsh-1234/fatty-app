'use client';

// Label photo flow (design 06-label-review). For products no database has, products without a
// barcode, to fill missing nutrients, and to correct a food whose numbers are wrong ("Numbers wrong?
// Photograph the label" on the amount sheet). The AI reads per-100 g values; the person checks them
// beside the photo; Confirm adds the food to the shared catalogue with the photo. A correction then
// offers to update the person's entries logged from the old values. Without an AI key the same form
// opens empty for typing the values in.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { CameraCapture } from '@/components/app/CameraCapture';
import { BackButton, Button, Card, cx, Dock, DockButton, Field, Notice, Screen, Spinner, Switch } from '@/components/ui';
import type { LabelResult } from '@/lib/ai/schemas';
import { signedPhotoUrl, uploadPhoto } from '@/lib/camera';
import { LABEL_PHOTO_BUCKET } from '@/lib/config';
import { getFood, toFood } from '@/lib/data';
import { correctEntries } from '@/lib/logging';
import { NUTRIENTS, type NutrientKey } from '@/lib/nutrients';
import { SOURCE_TAG, type Food } from '@/lib/types';

export default function LabelPage() {
  return (
    <Suspense fallback={null}>
      <Label />
    </Suspense>
  );
}

type Values = Record<NutrientKey, string>;
const emptyValues = () => Object.fromEntries(NUTRIENTS.map((n) => [n.key, ''])) as Values;
const fmt = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 100) / 100));
const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

function Label() {
  const app = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const barcode = params.get('barcode');
  const reason = params.get('reason');
  const date = params.get('d') ?? undefined;
  const forMeal = params.get('for');
  const fillId = params.get('mode') === 'fill' ? params.get('food') : null;
  const correctId = params.get('mode') === 'correct' ? params.get('food') : null;
  const hasKey = !!app.aiKey;

  const [rawStage, setStage] = useState<'capture' | 'front' | 'ready' | 'reading' | 'review'>(() =>
    params.get('photo') ? 'ready' : 'capture',
  );
  // Without an AI key the form opens straight away; a photo is optional evidence.
  const [wantsPhoto, setWantsPhoto] = useState(false);
  const stage = rawStage === 'capture' && app.loaded && !hasKey && !wantsPhoto ? 'review' : rawStage;
  const [photoPath, setPhotoPath] = useState<string | null>(params.get('photo'));
  const [frontPath, setFrontPath] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [labelPhotoId, setLabelPhotoId] = useState<string | null>(null);
  const [fillFood, setFillFood] = useState<Food | null>(null);
  /** The food a correction replaces, and what happened once it's confirmed. */
  const [correctFood, setCorrectFood] = useState<Food | null>(null);
  const [corrected, setCorrected] = useState<{ food: Food; existing: boolean; replaced: string; entries: number; updated: number | null } | null>(null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [serve, setServe] = useState('');
  const [pack, setPack] = useState('');
  const [liquid, setLiquid] = useState(false);
  const [values, setValues] = useState<Values>(emptyValues);
  const [unread, setUnread] = useState<Set<NutrientKey>>(new Set());
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; settings?: boolean } | null>(null);

  // Fill gaps on an existing food: only its missing values are asked for.
  useEffect(() => {
    if (!fillId) return;
    getFood(fillId)
      .then((f) => {
        setFillFood(f);
        setName(f.display_name ?? f.name);
        setServe(fmt(f.serving_g));
        setPack(fmt(f.pack_g));
        setLiquid(f.is_liquid);
        setValues(Object.fromEntries(NUTRIENTS.map((n) => [n.key, fmt(f[n.key])])) as Values);
      })
      .catch((e: Error) => setError({ message: e.message }));
  }, [fillId]);

  // A correction starts from the food's name and sizes; the values come from the label.
  useEffect(() => {
    if (!correctId) return;
    getFood(correctId)
      .then((f) => {
        setCorrectFood(f);
        setName(f.display_name ?? f.name);
        setBrand(f.brand ?? '');
        setServe(fmt(f.serving_g));
        setPack(fmt(f.pack_g));
        setLiquid(f.is_liquid);
      })
      .catch((e: Error) => setError({ message: e.message }));
  }, [correctId]);

  useEffect(() => {
    if (photoPath) void signedPhotoUrl(LABEL_PHOTO_BUCKET, photoPath).then(setPhotoUrl);
  }, [photoPath]);

  async function onPhoto(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const path = await uploadPhoto(LABEL_PHOTO_BUCKET, 'label', blob);
      if (stage === 'front') {
        setFrontPath(path);
        setStage('ready');
      } else {
        setPhotoPath(path);
        setWantsPhoto(false);
        setStage(hasKey ? 'ready' : 'review');
      }
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Couldn't upload the photo." });
    } finally {
      setBusy(false);
    }
  }

  async function read() {
    if (!photoPath) return;
    setStage('reading');
    setError(null);
    try {
      const res = await fetch('/api/label', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo_path: photoPath, front_path: frontPath, barcode: barcode ?? correctFood?.barcode ?? null, correct: !!correctFood }),
      });
      const body = (await res.json()) as { draft?: LabelResult; label_photo_id?: string; existing?: Record<string, unknown>; error?: string; settings?: boolean };
      // Someone already corrected this product from its label: use theirs.
      if (body.existing && correctFood) return void send();
      if (body.existing) return done(toFood(body.existing), true);
      if (!res.ok || !body.draft) throw Object.assign(new Error(body.error ?? "Couldn't read the label."), { settings: body.settings });
      applyDraft(body.draft);
      setLabelPhotoId(body.label_photo_id ?? null);
      setStage('review');
    } catch (e) {
      setStage('ready');
      setError({ message: e instanceof Error ? e.message : "Couldn't read the label.", settings: (e as { settings?: boolean }).settings });
    }
  }

  function applyDraft(d: LabelResult) {
    const p = { ...d.per_100 };
    const n: string[] = [];
    if (p.energy_kj == null && p.energy_kcal_only != null) {
      p.energy_kj = Math.round(p.energy_kcal_only * 4.184);
      n.push('Energy was printed in Cal only, so it was converted to kJ.');
    }
    if (d.derived_from_per_serve) n.push('Worked out from the per-serve column. Check these against the label.');
    const next = emptyValues();
    const missing = new Set<NutrientKey>();
    for (const info of NUTRIENTS) {
      const v = p[info.key as keyof typeof p];
      if (fillFood && fillFood[info.key] != null) next[info.key] = fmt(fillFood[info.key]);
      else if (v == null) missing.add(info.key);
      else next[info.key] = fmt(v);
    }
    setValues(next);
    setUnread(missing);
    setNotes(n);
    if (!fillFood) {
      if (d.product_name) setName(d.product_name);
      if (d.brand) setBrand(d.brand);
    }
    if (d.serving_size && !serve) setServe(fmt(d.serving_size));
    if (d.serving_size && d.servings_per_pack && !pack) setPack(fmt(Math.round(d.serving_size * d.servings_per_pack)));
    if (d.basis === 'per_100ml' || d.serving_unit === 'ml') setLiquid(true);
  }

  async function confirm() {
    setError(null);
    if (!name.trim()) return setError({ message: 'Add the product name.' });
    if (!fillFood && num(values.energy_kj) == null) return setError({ message: 'Energy is needed. Type it from the label.' });
    for (const n of NUTRIENTS) {
      const v = num(values[n.key]);
      if (v != null && !(v >= 0)) return setError({ message: `${n.label} doesn't look like a number.` });
    }
    await send();
  }

  async function send() {
    setBusy(true);
    try {
      const res = await fetch('/api/label/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: fillFood ? 'fill' : correctFood ? 'correct' : 'new',
          food_id: fillFood?.id ?? correctFood?.id,
          label_photo_id: labelPhotoId,
          photo_path: photoPath,
          barcode: barcode ?? correctFood?.barcode ?? null,
          name: name.trim() || correctFood?.name || 'Product',
          brand: brand.trim() || null,
          serving_g: num(serve),
          pack_g: num(pack),
          is_liquid: liquid,
          values: Object.fromEntries(NUTRIENTS.map((n) => [n.key, num(values[n.key])])),
        }),
      });
      const body = (await res.json()) as { food?: Record<string, unknown>; existing?: boolean; replaced?: string; entries?: number; error?: string };
      if (!res.ok || !body.food) throw new Error(body.error ?? "Couldn't save.");
      if (correctFood) {
        setCorrected({ food: toFood(body.food), existing: !!body.existing, replaced: body.replaced ?? correctFood.id, entries: body.entries ?? 0, updated: null });
        setStage('review');
        setBusy(false);
        return;
      }
      done(toFood(body.food), !!body.existing);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Couldn't save." });
      setBusy(false);
    }
  }

  function done(food: Food, existing: boolean) {
    if (fillFood) {
      router.replace(`/foods/${food.id}`);
      return;
    }
    if (forMeal) {
      sessionStorage.setItem('fatty:picked-ingredient', JSON.stringify({ id: food.id, at: Date.now() }));
      router.back();
      return;
    }
    if (existing) setNotes(['Someone already added this product, so theirs is shown.']);
    app.openAmount({ kind: 'food', foodId: food.id, food, method: 'label', date });
  }

  const readCount = useMemo(() => NUTRIENTS.filter((n) => values[n.key].trim() !== '').length, [values]);

  if (stage === 'capture' || stage === 'front') {
    return (
      <CameraCapture
        onPhoto={onPhoto}
        busy={busy}
        onBack={() => (stage === 'front' ? setStage('ready') : router.back())}
        hint={error?.message ?? (stage === 'front' ? 'Photograph the front of the pack, for the name' : 'Photograph the nutrition information panel')}
        bottom={
          stage === 'capture' && (
            <button type="button" onClick={() => setStage('review')} className="min-h-11 border-0 bg-transparent text-[16px] font-semibold text-pine-mint">
              Type the values in instead
            </button>
          )
        }
      />
    );
  }

  async function updateEntries() {
    if (!corrected) return;
    setBusy(true);
    setError(null);
    try {
      const n = await correctEntries(corrected.replaced, corrected.food, app.profile.time_zone);
      setCorrected({ ...corrected, updated: n });
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Couldn't update your entries." });
    } finally {
      setBusy(false);
    }
  }

  // A correction is confirmed: say so, and offer to update the entries from the old values.
  if (corrected) {
    const { food, existing, entries, updated } = corrected;
    const plural = entries === 1 ? 'entry' : 'entries';
    return (
      <Screen>
        <div className="sticky top-0 z-20 -mx-4 flex h-[60px] items-center justify-between bg-bg/90 px-2 backdrop-blur-md">
          <BackButton href="/" />
          <h1 className="text-[18px] font-semibold">Corrected</h1>
          <span className="w-11" />
        </div>
        <Card className="mt-2 flex flex-col gap-2">
          <h2 className="line-clamp-2 text-[18px] font-semibold leading-snug">{food.display_name ?? food.name}</h2>
          <p className="text-[15px] leading-snug text-ink2">
            {existing
              ? 'Someone already corrected this product from its label, so theirs is used.'
              : 'Saved from the label for everyone. Scanning or searching it now gives these values.'}
          </p>
        </Card>
        {entries > 0 && updated == null && (
          <Card className="mt-3 flex flex-col gap-3">
            <p className="text-[16px] leading-snug">
              Update your {entries} {plural} logged from the old values?
            </p>
            <p className="text-[13px] leading-snug text-ink2">Amounts and times stay as they are; only the nutrition values change to the label&apos;s.</p>
            <div className="flex gap-2">
              <Button size="md" onClick={updateEntries} disabled={busy} className="flex-1">
                {busy ? 'Updating…' : `Update ${entries} ${plural}`}
              </Button>
              <Button size="md" variant="secondary" onClick={() => setCorrected({ ...corrected, updated: 0 })} disabled={busy}>
                Not now
              </Button>
            </div>
          </Card>
        )}
        {updated != null && updated > 0 && <Notice className="mt-3 text-center">Updated {updated} {updated === 1 ? 'entry' : 'entries'}.</Notice>}
        <Notice tone="warn" className="mt-3">
          {error?.message}
        </Notice>
        {(entries === 0 || updated != null) && (
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={() => app.openAmount({ kind: 'food', foodId: food.id, food, method: 'label', date })}>Log it now</Button>
            <Button variant="secondary" onClick={() => router.replace(date && date !== app.today ? `/?d=${date}` : '/')}>
              Done
            </Button>
          </div>
        )}
      </Screen>
    );
  }

  const title = fillFood ? 'Fill the gaps' : correctFood ? 'Correct from the label' : 'Check the label';
  return (
    <Screen>
      <div className="sticky top-0 z-20 -mx-4 flex h-[60px] items-center justify-between bg-bg/90 px-2 backdrop-blur-md">
        <BackButton />
        <h1 className="text-[18px] font-semibold">{title}</h1>
        <div className="flex w-[88px] justify-end">
          {hasKey && stage === 'review' && (
            <Button size="sm" variant="secondary" onClick={() => { setStage('capture'); setFrontPath(null); }}>
              Retake
            </Button>
          )}
        </div>
      </div>

      {barcode && reason && stage !== 'review' && (
        <Notice className="mb-3">
          {reason === 'no_energy' ? 'Open Food Facts has this product but no energy value.' : 'No database has this barcode yet.'} Photograph its nutrition panel to add it for everyone.
        </Notice>
      )}

      {photoUrl ? (
        <div className="overflow-hidden rounded-card bg-pine-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="The nutrition panel" className="block max-h-[360px] w-full object-cover" />
        </div>
      ) : (
        stage === 'review' && (
          <Card className="flex items-center justify-between gap-3">
            <span className="text-[15px] text-ink2">Add a photo of the label as evidence (optional).</span>
            <Button size="sm" variant="secondary" onClick={() => { setWantsPhoto(true); setStage('capture'); }}>
              Photo
            </Button>
          </Card>
        )
      )}

      {stage === 'ready' && (
        <div className="mt-4 flex flex-col gap-2">
          <Notice tone="warn">
            {error?.message}
            {error?.settings && (
              <>
                {' '}
                <Link href="/settings#ai" className="font-semibold text-accent">Settings</Link>
              </>
            )}
          </Notice>
          <Button onClick={read}>{error ? 'Retry' : 'Read the label'}</Button>
          {!frontPath && (
            <Button variant="link" onClick={() => setStage('front')}>
              Also photograph the front, for the name
            </Button>
          )}
          <Button variant="quiet" onClick={() => setStage('review')}>
            Type the values in instead
          </Button>
        </div>
      )}

      {stage === 'reading' && (
        <div className="mt-8 flex flex-col items-center gap-3 text-ink2">
          <Spinner label="Reading the label" />
          Reading the label…
        </div>
      )}

      {stage === 'review' && (
        <>
          <p className="mx-1 mb-3 mt-3 text-center text-[15px] text-ink2">
            {labelPhotoId ? 'Read by your AI key. Check each value against the photo.' : 'Type the values from the label’s per-100 g column.'}
          </p>
          {notes.map((n) => (
            <Notice key={n} className="mb-2 text-center">
              {n}
            </Notice>
          ))}

          {!fillFood && (
            <Card className="mb-3 flex flex-col gap-4">
              <h2 className="text-[20px] font-semibold">Product</h2>
              <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Field label="Brand (optional)" value={brand} onChange={(e) => setBrand(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Serve size" unit={liquid ? 'ml' : 'g'} inputMode="decimal" value={serve} onChange={(e) => setServe(e.target.value.replace(/[^\d.,]/g, ''))} />
                <Field label="Pack size" unit={liquid ? 'ml' : 'g'} inputMode="decimal" value={pack} onChange={(e) => setPack(e.target.value.replace(/[^\d.,]/g, ''))} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-base">It&apos;s a drink (per 100 mL)</span>
                  <span className="block text-[13px] text-ink2">Stored per 100 g, assuming 1 g per mL.</span>
                </span>
                <Switch label="It's a drink" checked={liquid} onChange={setLiquid} />
              </div>
            </Card>
          )}

          <Card className="pb-2">
            <div className="-mx-5 flex min-h-12 items-center justify-between border-b border-separator px-5 pb-3">
              <span className="text-[20px] font-semibold">Per 100 {liquid ? 'mL' : 'g'}</span>
              <span className="text-[15px] text-ink2 tnum">{readCount} of 9 {labelPhotoId ? 'read' : 'filled'}</span>
            </div>
            {NUTRIENTS.map((n) => {
              const locked = !!fillFood && fillFood[n.key] != null;
              const isUnread = unread.has(n.key) && values[n.key] === '';
              return (
                <div key={n.key} className="flex min-h-[62px] items-center justify-between gap-3 border-t border-separator py-2 first:border-t-0">
                  <span className={cx('min-w-0', n.child && 'pl-6')}>
                    <span className={cx('block text-[17px]', n.child && 'text-ink2')}>{n.child ? n.label.replace(/ fat$/, '') : n.label}</span>
                    {isUnread && <span className="block text-[13px] text-ink2">Unreadable in the photo</span>}
                    {fillFood && !locked && <span className="block text-[13px] text-accent">Missing: fill from the label</span>}
                  </span>
                  <label
                    className={cx(
                      'flex h-[52px] w-[150px] shrink-0 items-center rounded-[26px] px-4',
                      isUnread ? 'border-[1.5px] border-dashed border-ink3 bg-transparent' : 'bg-raised',
                      'focus-within:shadow-[0_0_0_2.5px_var(--cc-focus),0_0_0_8px_var(--cc-focus-glow)]',
                    )}
                  >
                    <span className="sr-only">{n.label}</span>
                    <input
                      inputMode="decimal"
                      disabled={locked}
                      value={values[n.key]}
                      placeholder="–"
                      onChange={(e) => setValues((v) => ({ ...v, [n.key]: e.target.value.replace(/[^\d.,]/g, '') }))}
                      className="h-full min-w-0 flex-1 border-0 bg-transparent text-right text-[18px] font-medium outline-none tnum disabled:text-ink2"
                    />
                    <span className="w-8 pl-1.5 text-[14px] text-ink2">{n.unit}</span>
                  </label>
                </div>
              );
            })}
          </Card>

          <Notice tone="warn" className="mt-3">
            {error?.message}
          </Notice>
          <p className="mx-1 mt-3 text-center text-[14px] text-ink2">
            {fillFood
              ? 'Only the missing values are added. Everyone sees the filled-in food.'
              : correctFood
                ? `Confirm replaces the ${SOURCE_TAG[correctFood.source]} values with the label's, for everyone.`
                : 'Confirm adds it to the shared catalogue' + (photoPath ? ' with the photo.' : '.')}
          </p>
          <Dock>
            <DockButton primary onClick={confirm} disabled={busy}>
              {busy ? 'Saving…' : 'Confirm'}
            </DockButton>
          </Dock>
        </>
      )}
    </Screen>
  );
}
