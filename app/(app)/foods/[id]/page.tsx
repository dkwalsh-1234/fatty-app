'use client';

// Food detail: per-100 g values with their source, who added it and when, household measures
// (add your own: "my bowl · 320 g"), edit, and "Fill gaps from label photo". Edits make your own
// copy; the shared row stays untouched.

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { NutritionCard } from '@/components/app/NutritionCard';
import { Button, Card, CardHeader, Dock, DockButton, Field, Icon, Notice, Screen, Sheet, Spinner, Switch, TopBar } from '@/components/ui';
import { signedPhotoUrl } from '@/lib/camera';
import { LABEL_PHOTO_BUCKET } from '@/lib/config';
import { shortDateYear } from '@/lib/dates';
import { addMeasure, deleteMeasure, displayNames, getFood, getMeasures, savePrivateCopy, userId } from '@/lib/data';
import { amountText, int } from '@/lib/format';
import { NUTRIENT_BY_KEY, NUTRIENTS, type NutrientKey } from '@/lib/nutrients';
import { supabase } from '@/lib/supabase/browser';
import type { Food, Measure } from '@/lib/types';

const SOURCE_LINE: Record<Food['source'], string> = {
  user: 'Your food',
  meal: 'Your meal',
  label: 'Shared catalogue, from a label',
  fsanz_branded: 'FSANZ Branded Food Database',
  off: 'Open Food Facts (Open Database License)',
  ausnut: 'FSANZ, AUSNUT 2023',
  afcd: 'FSANZ, Australian Food Composition Database',
  ai: 'AI estimate: values from your AI provider, not a database',
};

export default function FoodPage() {
  const app = useApp();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [food, setFood] = useState<Food | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [addedBy, setAddedBy] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newGrams, setNewGrams] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [f, m, uid] = await Promise.all([getFood(id), getMeasures(id), userId()]);
      if (f.source === 'meal') return router.replace(`/meals/${f.id}`);
      setFood(f);
      setMeasures(m);
      setMe(uid);
      if (f.created_by && f.created_by !== uid) setAddedBy((await displayNames([f.created_by]))[f.created_by] ?? null);
      const { data } = await supabase().from('label_photos').select('storage_path').eq('food_id', f.id).order('created_at').limit(1);
      if (data?.[0]) setPhoto(await signedPhotoUrl(LABEL_PHOTO_BUCKET, data[0].storage_path));
    })().catch((e: Error) => setError(e.message));
  }, [id, router]);

  async function add() {
    const g = Number(newGrams.replace(',', '.'));
    if (!newLabel.trim() || !(g > 0)) return setError('Give the measure a name and a weight in grams.');
    try {
      const m = await addMeasure(id, newLabel.trim(), g);
      setMeasures((xs) => [m, ...xs]);
      setNewLabel('');
      setNewGrams('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add it.");
    }
  }

  if (!food) {
    return (
      <div className="flex min-h-[60dvh] items-center justify-center">
        {error ? <Notice tone="warn">{error}</Notice> : <Spinner />}
      </div>
    );
  }

  const mine = food.visibility === 'private' && food.created_by === me;
  const who = food.created_by === me ? 'you' : addedBy;
  const missing = food.missing_nutrients.map((k) => NUTRIENT_BY_KEY[k as NutrientKey]?.label.toLowerCase()).filter(Boolean);

  return (
    <Screen>
      <TopBar back />
      <div className="mb-4 px-1">
        <h1 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.025em]">{food.display_name ?? food.name}</h1>
        {food.brand && <p className="mt-0.5 text-[16px] text-ink2">{food.brand}</p>}
        <p className="mt-1.5 text-[14px] leading-snug text-ink2">
          {SOURCE_LINE[food.source]}
          {who && ` · added by ${who}`}, {shortDateYear(food.created_at.slice(0, 10))}
          {food.barcode && ` · barcode ${food.barcode}`}
        </p>
        {food.derived_from_food_id && (
          <p className="mt-1 text-[14px] text-ink2">
            Your edited copy.{' '}
            <Link href={`/foods/${food.derived_from_food_id}`} className="font-semibold text-accent">
              See the original
            </Link>
          </p>
        )}
        {food.display_name && food.display_name !== food.name && <p className="mt-1 text-[13px] text-ink2">Listed as “{food.name}”</p>}
      </div>

      <div className="flex flex-col gap-3">
        {photo && (
          <div className="overflow-hidden rounded-card bg-pine-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="The label this food was read from" className="block max-h-[260px] w-full object-cover" />
          </div>
        )}
        <NutritionCard per100={food} serveGrams={food.serving_g} unit={app.profile.energy_unit} liquid={food.is_liquid} />
        {missing.length > 0 && (
          <Card>
            <p className="text-[15px] text-ink2">No value for {missing.join(', ')}. Day totals that include this food are marked incomplete.</p>
            <Link href={`/log/label?mode=fill&food=${food.id}`} className="mt-1 inline-block min-h-11 py-2.5 text-[16px] font-semibold text-accent no-underline">
              Fill gaps from label photo
            </Link>
          </Card>
        )}

        <Card className="pb-3">
          <CardHeader title="Measures" right={measures.length || null} />
          {food.serving_g && !measures.some((m) => Math.abs(m.grams - food.serving_g!) < 0.5) && (
            <div className="flex min-h-12 items-center justify-between border-t border-separator first:border-t-0">
              <span className="text-[15px]">1 serve</span>
              <span className="text-[15px] text-ink2 tnum">{amountText(food.serving_g, 'g')}</span>
            </div>
          )}
          {measures.map((m) => (
            <div key={m.id} className="flex min-h-12 items-center gap-2 border-t border-separator">
              <span className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug">{m.label}</span>
              <span className="text-[15px] text-ink2 tnum">{int(m.grams)} g</span>
              {m.owner_id === me && (
                <button
                  type="button"
                  aria-label={`Remove ${m.label}`}
                  onClick={async () => {
                    await deleteMeasure(m.id).catch(() => {});
                    setMeasures((xs) => xs.filter((x) => x.id !== m.id));
                  }}
                  className="flex h-11 w-9 items-center justify-center border-0 bg-transparent p-0 text-ink2"
                >
                  <Icon name="remove" size={20} />
                </button>
              )}
            </div>
          ))}
          <div className="mt-2 flex items-end gap-2">
            <Field label="Add your own" placeholder="my bowl" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="min-w-0 flex-1" />
            <Field unit="g" inputMode="decimal" aria-label="Grams" placeholder="320" value={newGrams} onChange={(e) => setNewGrams(e.target.value.replace(/[^\d.,]/g, ''))} className="w-[110px]" />
            <Button size="md" variant="secondary" onClick={add}>
              Add
            </Button>
          </div>
          <p className="mt-2 text-[13px] text-ink2">Your measures appear as chips on the amount sheet. Only you see them.</p>
        </Card>
        <Notice tone="warn">{error}</Notice>
      </div>

      <Dock>
        <DockButton onClick={() => setEditing(true)}>{mine ? 'Edit' : 'Edit my copy'}</DockButton>
        <DockButton primary onClick={() => app.openAmount({ kind: 'food', foodId: food.id, food, method: 'search' })}>
          Log
        </DockButton>
      </Dock>
      <EditFood
        food={food}
        open={editing}
        mine={mine}
        onClose={() => setEditing(false)}
        onSaved={(f) => {
          setEditing(false);
          if (f.id !== food.id) router.replace(`/foods/${f.id}`);
          else setFood(f);
        }}
      />
    </Screen>
  );
}

function EditFood({ food, open, mine, onClose, onSaved }: { food: Food; open: boolean; mine: boolean; onClose: () => void; onSaved: (f: Food) => void }) {
  const str = (n: number | null) => (n == null ? '' : String(Math.round(n * 100) / 100));
  const [name, setName] = useState(food.display_name ?? food.name);
  const [serve, setServe] = useState(str(food.serving_g));
  const [pack, setPack] = useState(str(food.pack_g));
  const [liquid, setLiquid] = useState(food.is_liquid);
  const [values, setValues] = useState(() => Object.fromEntries(NUTRIENTS.map((n) => [n.key, str(food[n.key])])) as Record<NutrientKey, string>);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await savePrivateCopy(food, {
        name: name.trim() || food.name,
        display_name: name.trim() || food.display_name,
        serving_g: num(serve),
        pack_g: num(pack),
        is_liquid: liquid,
        ...Object.fromEntries(NUTRIENTS.map((n) => [n.key, num(values[n.key])])),
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Edit food">
      <div className="flex flex-col gap-3 pb-2">
        <h2 className="pt-1 text-center text-[17px] font-semibold">{mine ? 'Edit food' : 'Edit your copy'}</h2>
        {!mine && <p className="px-2 text-center text-[14px] text-ink2">Changes make your own copy. The shared food stays as it is for everyone else.</p>}
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Serve" unit="g" inputMode="decimal" value={serve} onChange={(e) => setServe(e.target.value)} />
          <Field label="Pack" unit="g" inputMode="decimal" value={pack} onChange={(e) => setPack(e.target.value)} />
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-base">It&apos;s a drink (ml)</span>
          <Switch label="It's a drink" checked={liquid} onChange={setLiquid} />
        </div>
        <div className="rounded-card bg-raised px-4 py-1">
          {NUTRIENTS.map((n) => (
            <label key={n.key} className="flex min-h-12 items-center justify-between gap-3 border-t border-separator first:border-t-0">
              <span className={n.child ? 'pl-4 text-ink2' : ''}>{n.label} <span className="text-[13px] text-ink2">per 100 g</span></span>
              <span className="flex items-center gap-1">
                <input
                  inputMode="decimal"
                  value={values[n.key]}
                  placeholder="–"
                  onChange={(e) => setValues((v) => ({ ...v, [n.key]: e.target.value.replace(/[^\d.,]/g, '') }))}
                  className="h-10 w-[90px] rounded-[20px] border-0 bg-surface px-3 text-right text-[16px] tnum"
                />
                <span className="w-7 text-[13px] text-ink2">{n.unit}</span>
              </span>
            </label>
          ))}
        </div>
        <Notice tone="warn">{error}</Notice>
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Sheet>
  );
}
