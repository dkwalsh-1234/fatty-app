'use client';

// Settings: nutrient targets with direction, energy target and unit, warning thresholds, meal time
// boundaries, widget nutrients, AI key (three providers as equals), Health Connect, account, About.

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { AiKeyPicker } from '@/components/forms/AiKeyPicker';
import { Button, CapsLabel, Card, cx, Field, Icon, Notice, Row, Screen, ScreenTitle, Segmented, Select, Switch, TopBar } from '@/components/ui';
import { KEY_SCREEN_COPY } from '@/lib/ai/config';
import { healthStatus, inWrapper, openHealthSettings, requestHealthPermissions, type HealthStatus } from '@/lib/bridge';
import { DEFAULT_MEAL_BOUNDARIES, MEAL_LABEL, MEALS, type Meal, type MealBoundary } from '@/lib/dates';
import { dayEntries, deleteTarget, saveProfile, saveTarget } from '@/lib/data';
import { buildDay } from '@/lib/day';
import { int, kcalIn, unitLabel } from '@/lib/format';
import { syncToHealth } from '@/lib/logging';
import { NUTRIENT_BY_ID, NUTRIENTS } from '@/lib/nutrients';
import { DEFAULT_FLOOR_KCAL, targetsConflict, type Direction } from '@/lib/target';
import type { Profile, TargetRow } from '@/lib/types';

const TARGETABLE = NUTRIENTS.filter((n) => n.key !== 'energy_kj');
const DIRECTION_LABEL: Record<Direction, string> = { min: 'At least', max: 'No more than', range: 'Range' };

export default function SettingsPage() {
  const app = useApp();
  const p = app.profile;
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(changes: Partial<Profile>, msg = 'Saved.') {
    setError(null);
    try {
      await saveProfile(changes);
      app.setProfile({ ...app.profile, ...changes });
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    }
  }

  const today = useMemo(
    () => buildDay({ date: app.today, entries: [], profile: p, goal: app.goal, weighIns: app.weighIns, burn: app.burn, targets: [] }),
    [app.today, p, app.goal, app.weighIns, app.burn],
  );
  const conflict = today.target ? targetsConflict(app.targets, today.target.target) : null;

  return (
    <Screen>
      <TopBar back="/" />
      <ScreenTitle>Settings</ScreenTitle>
      <Notice className="mb-2">{notice}</Notice>
      <Notice tone="warn" className="mb-2">
        {error}
      </Notice>

      <CapsLabel>
        <span id="targets">Nutrient targets</span>
      </CapsLabel>
      <Targets onError={setError} />
      {conflict && <Notice className="mt-2">{conflict}</Notice>}

      <CapsLabel>Energy</CapsLabel>
      <Card className="flex flex-col gap-4">
        <div>
          <span className="mb-1.5 block text-[15px] text-ink2">Show energy in</span>
          <Segmented
            label="Energy unit"
            value={p.energy_unit}
            onChange={(v) => patch({ energy_unit: v })}
            options={[
              { value: 'kcal', label: 'kcal' },
              { value: 'kj', label: 'kJ' },
            ]}
          />
        </div>
        <Row
          label="Daily energy target"
          sub={p.energy_target_override_kcal ? 'Your own number' : 'Worked out from your body, activity and goal'}
          value={today.target ? `${int(kcalIn(today.target.target, p.energy_unit))} ${unitLabel(p.energy_unit)}` : '–'}
          href="/goal"
        />
        <div className="flex items-center justify-between gap-3 border-t border-separator pt-3">
          <span>
            <span className="block text-base">Stable mode</span>
            <span className="block text-[13px] leading-snug text-ink2">Use your 7-day average burn for the whole day, so the target doesn&apos;t move as activity comes in.</span>
          </span>
          <Switch label="Stable mode" checked={p.stable_mode} onChange={(v) => patch({ stable_mode: v })} />
        </div>
      </Card>

      <CapsLabel>Warnings</CapsLabel>
      <Warnings onSave={patch} />

      <CapsLabel>Meal times</CapsLabel>
      <MealTimes onSave={patch} />

      <CapsLabel>Widget</CapsLabel>
      <WidgetNutrients onSave={patch} />

      <CapsLabel>
        <span id="ai">AI key</span>
      </CapsLabel>
      <p className="mx-1 mb-2 text-[15px] leading-[1.45]">{KEY_SCREEN_COPY.intro}</p>
      <p className="mx-1 mb-3 text-[14px] leading-[1.45] text-ink2">{KEY_SCREEN_COPY.billing}</p>
      <AiKeyPicker
        current={app.aiKey}
        onSaved={() => {
          void app.reload(['aiKey']);
          setNotice('Key saved. Only its last four characters are shown from now on.');
        }}
        onDeleted={() => {
          void app.reload(['aiKey']);
          setNotice('Key deleted.');
        }}
      />

      <CapsLabel>Health Connect</CapsLabel>
      <Health onSave={patch} />

      <CapsLabel>Account</CapsLabel>
      <Card className="py-2">
        <Row label="Email" value={app.email} />
        <Row label="Password" sub="Set a new password" href="/welcome" />
        {app.isAdmin && <Row label="Admin" sub="Invite friends and manage access" href="/admin" />}
        <Row label="About and data credits" href="/about" />
        <form action="/auth/signout" method="post" className="border-t border-separator pt-1">
          <button type="submit" className="min-h-12 w-full border-0 bg-transparent text-left text-base font-semibold text-warn-text">
            Sign out
          </button>
        </form>
      </Card>
    </Screen>
  );
}

function Targets({ onError }: { onError: (e: string | null) => void }) {
  const app = useApp();
  const [adding, setAdding] = useState('');
  // A target being added: nothing is saved until its numbers are typed. None are preset.
  const [draft, setDraft] = useState<TargetRow | null>(null);
  const used = new Set([...app.targets.map((t) => t.nutrient), ...(draft ? [draft.nutrient] : [])]);
  const available = TARGETABLE.filter((n) => !used.has(n.id));

  async function save(t: TargetRow) {
    onError(null);
    try {
      await saveTarget(t);
      await app.reload(['targets']);
      setDraft(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save the target.");
    }
  }

  return (
    <Card className="flex flex-col gap-1 py-3">
      {app.targets.length === 0 && !draft && <p className="py-1 text-[15px] text-ink2">None set. Add any nutrient you care about; none are preset.</p>}
      {app.targets
        .slice()
        .sort((a, b) => TARGETABLE.findIndex((n) => n.id === a.nutrient) - TARGETABLE.findIndex((n) => n.id === b.nutrient))
        .map((t) => (
          <TargetEditor key={t.nutrient} target={t} onSave={save} onRemove={async () => { await deleteTarget(t.nutrient).catch(() => {}); await app.reload(['targets']); }} />
        ))}
      {draft && <TargetEditor key={`new-${draft.nutrient}`} target={draft} isNew onSave={save} onRemove={() => setDraft(null)} />}
      {available.length > 0 && !draft && (
        <div className="flex items-end gap-2 border-t border-separator pt-3">
          <Select label="Add a target" value={adding} onChange={(e) => setAdding(e.target.value)} className="flex-1">
            <option value="">Choose a nutrient</option>
            {available.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </Select>
          <Button
            size="md"
            variant="secondary"
            disabled={!adding}
            onClick={() => {
              const dir: Direction = adding === 'protein' || adding === 'fibre' ? 'min' : adding === 'carbs' ? 'range' : 'max';
              setDraft({ nutrient: adding, direction: dir, low: null, high: null });
              setAdding('');
            }}
          >
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function TargetEditor({ target, onSave, onRemove, isNew }: { target: TargetRow; onSave: (t: TargetRow) => void; onRemove: () => void; isNew?: boolean }) {
  const info = NUTRIENT_BY_ID[target.nutrient];
  const [direction, setDirection] = useState<Direction>(target.direction);
  const [low, setLow] = useState(target.low != null ? String(target.low) : '');
  const [high, setHigh] = useState(target.high != null ? String(target.high) : '');
  const dirty = !!isNew || direction !== target.direction || low !== (target.low != null ? String(target.low) : '') || high !== (target.high != null ? String(target.high) : '');
  const n = (s: string) => (s.trim() ? Number(s.replace(',', '.')) : null);
  const valid = direction === 'min' ? (n(low) ?? -1) >= 0 : direction === 'max' ? (n(high) ?? -1) >= 0 : (n(low) ?? -1) >= 0 && (n(high) ?? -1) >= (n(low) ?? 0);
  return (
    <div className="flex flex-col gap-2 border-t border-separator py-3 first:border-t-0">
      <div className="flex items-center justify-between">
        <span className="text-base font-medium">{info?.label ?? target.nutrient}</span>
        <button type="button" aria-label={`Remove the ${info?.label} target`} onClick={onRemove} className="flex h-9 w-9 items-center justify-center border-0 bg-transparent text-ink2">
          <Icon name="remove" size={20} />
        </button>
      </div>
      <Segmented
        label={`${info?.label} direction`}
        value={direction}
        onChange={setDirection}
        options={(['min', 'max', 'range'] as Direction[]).map((d) => ({ value: d, label: DIRECTION_LABEL[d] }))}
      />
      <div className="flex gap-2">
        {direction !== 'max' && <Field label={direction === 'range' ? 'From' : 'At least'} unit={info?.unit} inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} className="flex-1" />}
        {direction !== 'min' && <Field label={direction === 'range' ? 'To' : 'No more than'} unit={info?.unit} inputMode="decimal" value={high} onChange={(e) => setHigh(e.target.value)} className="flex-1" />}
      </div>
      {dirty && (
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => onSave({ nutrient: target.nutrient, direction, low: direction === 'max' ? null : n(low), high: direction === 'min' ? null : n(high) })}
        >
          Save {info?.label.toLowerCase()} target
        </Button>
      )}
    </div>
  );
}

function Warnings({ onSave }: { onSave: (c: Partial<Profile>, msg?: string) => void }) {
  const p = useApp().profile;
  const [rate, setRate] = useState(String(p.warn_rate_pct_per_week));
  const [floor, setFloor] = useState(p.warn_floor_kcal != null ? String(p.warn_floor_kcal) : '');
  const def = p.sex ? DEFAULT_FLOOR_KCAL[p.sex] : 1200;
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-[13px] leading-snug text-ink2">These are advice, not walls: a warning can always be continued past. Typing your own target never warns.</p>
      <Field label="Warn when a goal needs more than" unit="% a week" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
      <Field label="Warn when the daily target is below" unit="kcal" inputMode="numeric" placeholder={String(def)} value={floor} onChange={(e) => setFloor(e.target.value.replace(/\D/g, ''))} hint={`Blank uses the usual ${def.toLocaleString('en-AU')} kcal.`} />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          const r = Number(rate.replace(',', '.'));
          if (!(r > 0 && r < 10)) return;
          onSave({ warn_rate_pct_per_week: r, warn_floor_kcal: floor ? Number(floor) : null }, 'Warning thresholds saved.');
        }}
      >
        Save thresholds
      </Button>
    </Card>
  );
}

function MealTimes({ onSave }: { onSave: (c: Partial<Profile>, msg?: string) => void }) {
  const p = useApp().profile;
  const [rows, setRows] = useState<MealBoundary[]>(p.meal_boundaries ?? DEFAULT_MEAL_BOUNDARIES);
  return (
    <Card className="flex flex-col gap-2">
      <p className="text-[13px] leading-snug text-ink2">New entries go to the meal for the time of day: each meal starts at its time. Changing it on an entry is never required.</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
          <input
            type="time"
            aria-label={`Start of ${MEAL_LABEL[r.meal]}`}
            value={r.from}
            onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
            className="h-11 w-full min-w-0 rounded-[22px] border-0 bg-raised px-3 text-[15px] tnum"
          />
          <select
            aria-label="Meal"
            value={r.meal}
            onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, meal: e.target.value as Meal } : x)))}
            className="h-11 w-full min-w-0 rounded-[22px] border-0 bg-raised px-4 text-[15px]"
          >
            {MEALS.map((m) => (
              <option key={m} value={m}>
                {MEAL_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={() => onSave({ meal_boundaries: [...rows].sort((a, b) => a.from.localeCompare(b.from)) }, 'Meal times saved.')}>
          Save meal times
        </Button>
        <Button size="sm" variant="quiet" onClick={() => setRows(DEFAULT_MEAL_BOUNDARIES)}>
          Reset
        </Button>
      </div>
    </Card>
  );
}

function WidgetNutrients({ onSave }: { onSave: (c: Partial<Profile>, msg?: string) => void }) {
  const p = useApp().profile;
  const chosen = p.widget_nutrients;
  return (
    <Card className="py-2">
      <p className="pb-1 pt-1 text-[13px] text-ink2">The home-screen widget shows three nutrients.</p>
      {TARGETABLE.map((n) => {
        const on = chosen.includes(n.id);
        return (
          <button
            key={n.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={!on && chosen.length >= 3}
            onClick={() => onSave({ widget_nutrients: on ? chosen.filter((x) => x !== n.id) : [...chosen, n.id] }, 'Widget updated.')}
            className="flex min-h-12 w-full items-center gap-3 border-0 border-t border-separator bg-transparent text-left first:border-t-0 disabled:opacity-50"
          >
            <span className={cx('flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-2', on ? 'border-accent bg-accent text-surface' : 'border-ink2')}>
              {on && <Icon name="check" size={14} stroke={3} />}
            </span>
            <span className="text-base">{n.label}</span>
          </button>
        );
      })}
    </Card>
  );
}

function Health({ onSave }: { onSave: (c: Partial<Profile>, msg?: string) => void }) {
  const app = useApp();
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const wrapper = inWrapper();

  useEffect(() => {
    if (wrapper) void healthStatus().then(setStatus);
  }, [wrapper]);

  if (!wrapper) {
    return (
      <Card>
        <p className="text-[15px] leading-snug text-ink2">
          Health Connect works in the Fatty Android app: it writes what you eat, and reads calories burned from your watch (Garmin Connect sends them through Health Connect).
        </p>
      </Card>
    );
  }

  const sources = [...new Set(app.burn.map((b) => b.source_app))];
  async function ask(scope: 'write' | 'read') {
    setBusy(scope);
    const s = await requestHealthPermissions(scope);
    if (s) setStatus(s);
    setBusy(null);
    if (s && scope === 'read' && (s.readTotalCalories || s.readActiveCalories)) void app.syncBurn();
  }

  return (
    <Card className="flex flex-col gap-1 py-2">
      {!status ? (
        <p className="py-2 text-[15px] text-ink2">Checking…</p>
      ) : !status.available ? (
        <p className="py-2 text-[15px] text-ink2">{status.needsUpdate ? 'Health Connect needs installing or updating.' : 'Health Connect is not available on this phone.'}</p>
      ) : (
        <>
          <Row label="Write what I eat" value={status.writeNutrition ? 'On' : 'Off'} />
          {!status.writeNutrition && (
            <Button size="sm" variant="secondary" onClick={() => ask('write')} disabled={!!busy}>
              Allow writing food
            </Button>
          )}
          <Row label="Read calories burned" sub="For a target that follows your activity. Skip this if you don't wear a watch." value={status.readTotalCalories || status.readActiveCalories ? 'On' : 'Off'} />
          {!(status.readTotalCalories || status.readActiveCalories) && (
            <Button size="sm" variant="secondary" onClick={() => ask('read')} disabled={!!busy}>
              Allow reading calories burned
            </Button>
          )}
          {status.lastSyncAt && <Row label="Last sync" value={new Date(status.lastSyncAt).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' })} />}
          {sources.length > 1 && (
            <Select
              label="Use calories burned from"
              value={app.profile.burn_source ?? ''}
              onChange={(e) => onSave({ burn_source: e.target.value || null }, 'Burn source saved.')}
              className="py-2"
            >
              <option value="">The app with the highest total each day</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
          <div className="flex flex-wrap gap-2 py-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={async () => {
                setBusy('resync');
                const entries = await dayEntries(app.today);
                await syncToHealth(entries, app.profile.time_zone);
                setStatus(await healthStatus());
                setMsg(`Sent ${entries.length} of today's entries again. Health Connect replaces, never duplicates.`);
                setBusy(null);
              }}
            >
              Resync today
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!!busy}
              onClick={async () => {
                setBusy('burn');
                await app.syncBurn();
                setMsg('Calories burned refreshed.');
                setBusy(null);
              }}
            >
              Refresh burn
            </Button>
            <Button size="sm" variant="quiet" onClick={() => openHealthSettings()}>
              Open Health Connect
            </Button>
          </div>
          <Notice>{msg}</Notice>
        </>
      )}
    </Card>
  );
}
