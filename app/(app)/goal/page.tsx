'use client';

// Goal: weight trend with start, current and goal weight and the on-pace line; how today's target
// is worked out (measured or estimated activity, and the last 7 days of burn); dismissed warnings;
// edit goal and profile. Honest about precision: judge progress by the weight trend.

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { WeightChart, type WeightPoint } from '@/components/app/WeightChart';
import { WeighInSheet } from '@/components/app/WeighInSheet';
import { evaluateGoal, GoalForm, type GoalValues } from '@/components/forms/GoalForm';
import { ProfileForm, profileErrors, type ProfileValues } from '@/components/forms/ProfileForm';
import { Button, CapsLabel, Card, Icon, Notice, Screen, ScreenTitle, TopBar } from '@/components/ui';
import { inWrapper } from '@/lib/bridge';
import { addDays, localDate, shortDate, shortDateYear } from '@/lib/dates';
import { buildDay, pickBurn } from '@/lib/day';
import { deleteWeighIn, saveGoal, saveProfile } from '@/lib/data';
import { int, kcalIn, kg, unitLabel } from '@/lib/format';
import { ACTIVITY_FACTORS, ACTIVITY_LABELS, KCAL_PER_KG, type WarningKey } from '@/lib/target';

const WARNING_NAMES: Record<string, string> = {
  rate: 'Faster than 1% of body weight a week',
  floor: 'Daily target below the usual floor',
};

export default function GoalPage() {
  const app = useApp();
  const tz = app.profile.time_zone;
  const unit = app.profile.energy_unit;
  const u = unitLabel(unit);
  const [weighing, setWeighing] = useState(false);
  const [editGoal, setEditGoal] = useState(false);
  const [editProfile, setEditProfile] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Burn is read from Health Connect when this screen opens.
  useEffect(() => {
    void app.syncBurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const day = useMemo(
    () => buildDay({ date: app.today, entries: [], profile: app.profile, goal: app.goal, weighIns: app.weighIns, burn: app.burn, targets: [] }),
    [app.today, app.profile, app.goal, app.weighIns, app.burn],
  );
  const t = day.target;
  const goal = app.goal;

  const points: WeightPoint[] = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const w of app.weighIns) byDay.set(localDate(tz, new Date(w.measured_at)), w.weight_kg);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, kg: v }));
  }, [app.weighIns, tz]);

  const currentKg = day.goal?.currentKg ?? points[points.length - 1]?.kg ?? goal?.start_weight_kg ?? null;
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(app.today, -i)).map((d) => ({ date: d, burn: pickBurn(app.burn, d, app.profile.burn_source) }));
  const sources = [...new Set(app.burn.map((b) => b.source_app))];

  return (
    <Screen>
      <TopBar back="/" />
      <ScreenTitle
        sub={
          goal
            ? `${goal.target_weight_kg < goal.start_weight_kg ? 'Losing' : 'Gaining'} to ${kg(goal.target_weight_kg)} kg by ${shortDateYear(goal.target_date)}. Started at ${kg(goal.start_weight_kg)} kg on ${shortDate(goal.start_date)}.`
            : 'No goal yet.'
        }
      >
        Goal and weight
      </ScreenTitle>

      <Card>
        {points.length ? (
          <WeightChart
            points={points}
            today={app.today}
            goal={goal ? { startDate: goal.start_date, startKg: goal.start_weight_kg, targetDate: goal.target_date, targetKg: goal.target_weight_kg } : null}
          />
        ) : (
          <p className="text-[15px] text-ink2">Log a weigh-in to start your trend.</p>
        )}
        {day.goal && (
          <p className="mt-2 text-[13px] text-ink2 tnum">
            Now {kg(day.goal.currentKg)} kg · on pace would be {kg(day.goal.paceKg)} kg today · {Math.round(day.goal.progress * 100)}% of the way
          </p>
        )}
      </Card>

      <CapsLabel>Weigh-ins</CapsLabel>
      <Card className="py-2">
        {points.length === 0 && <p className="py-2 text-[15px] text-ink2">None yet.</p>}
        {[...app.weighIns].reverse().slice(0, 8).map((w) => (
          <div key={w.id} className="flex min-h-12 items-center gap-3 border-t border-separator first:border-t-0">
            <span className="flex-1 text-[15px]">{shortDateYear(localDate(tz, new Date(w.measured_at)))}</span>
            <span className="text-[15px] font-medium tnum">{kg(w.weight_kg)} kg</span>
            <button
              type="button"
              aria-label={`Delete the ${kg(w.weight_kg)} kg weigh-in`}
              onClick={async () => {
                await deleteWeighIn(w.id).catch(() => {});
                await app.reload(['weighIns']);
              }}
              className="flex h-11 w-9 items-center justify-center border-0 bg-transparent p-0 text-ink2"
            >
              <Icon name="remove" size={20} />
            </button>
          </div>
        ))}
        <Button variant="link" onClick={() => setWeighing(true)}>
          Log a weigh-in
        </Button>
      </Card>

      {t && (
        <>
          <CapsLabel>How today&apos;s target is worked out</CapsLabel>
          <Card className="flex flex-col gap-0 py-2">
            <Line label="Resting energy" sub="Mifflin-St Jeor, from your age, sex, height and latest weight" value={`${int(kcalIn(t.resting, unit))} ${u}`} />
            <Line
              label="Activity"
              sub={
                t.activitySource === 'measured'
                  ? 'Measured today through Health Connect'
                  : t.activitySource === 'stable'
                    ? 'Stable mode: from your 7-day average burn'
                    : t.activitySource === 'override'
                      ? 'Not used: you typed your own target'
                      : `Estimated: ${ACTIVITY_LABELS[app.profile.activity_level ?? 'sitting'].toLowerCase()} (resting × ${ACTIVITY_FACTORS[app.profile.activity_level ?? 'sitting']})`
              }
              value={`${int(kcalIn(t.activity, unit))} ${u}`}
            />
            <Line
              label="Goal adjustment"
              sub={t.daysLeft != null && goal && currentKg ? `${kg(Math.abs(goal.target_weight_kg - currentKg))} kg × ${KCAL_PER_KG.toLocaleString('en-AU')} kcal ÷ ${t.daysLeft} days left` : 'No goal'}
              value={`${t.adjustment < 0 ? '−' : '+'}${int(kcalIn(Math.abs(t.adjustment), unit))} ${u}`}
            />
            <Line label="Today's target" sub="Rounded to the nearest 10" value={`${int(kcalIn(t.target, unit))} ${u}`} strong />
          </Card>
          <p className="mx-1 mt-2 text-[13px] leading-snug text-ink2">
            Watch estimates of calories burned are often 20 to 30% out, the formula is a population average, and 7,700 kcal per kg is a rule of thumb that overstates loss over longer periods. Judge progress by your weight trend.
          </p>
        </>
      )}

      <CapsLabel>Calories burned, last 7 days</CapsLabel>
      <Card className="py-2">
        {last7.every((d) => !d.burn) ? (
          <p className="py-2 text-[15px] leading-snug text-ink2">
            {inWrapper() ? 'Nothing from Health Connect yet. Allow reading calories burned in Settings.' : 'Burn comes from Health Connect in the Android app. Until then, activity is estimated.'}
          </p>
        ) : (
          last7.map((d) => (
            <div key={d.date} className="flex min-h-11 items-center gap-3 border-t border-separator first:border-t-0">
              <span className="flex-1 text-[15px]">{d.date === app.today ? 'Today' : shortDate(d.date)}</span>
              <span className="text-[14px] text-ink2 tnum">{d.burn?.active_kcal != null ? `${int(d.burn.active_kcal)} active` : ''}</span>
              <span className="w-[86px] text-right text-[15px] font-medium tnum">{d.burn?.total_kcal != null ? `${int(d.burn.total_kcal)} total` : '–'}</span>
            </div>
          ))
        )}
        {sources.length > 1 && <p className="pb-1 pt-2 text-[12px] text-ink2">Several apps write burn. One is used per day, never added together; choose which in Settings.</p>}
      </Card>

      {goal && goal.warnings_dismissed.length > 0 && (
        <>
          <CapsLabel>Warnings you continued past</CapsLabel>
          <Card className="py-2">
            {goal.warnings_dismissed.map((w) => (
              <div key={w} className="flex min-h-11 items-center border-t border-separator text-[15px] first:border-t-0">
                {WARNING_NAMES[w] ?? w}
              </div>
            ))}
          </Card>
        </>
      )}

      <CapsLabel>Change</CapsLabel>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setEditGoal((v) => !v)}>
          {editGoal ? 'Close goal' : goal ? 'Edit goal' : 'Set a goal'}
        </Button>
        {editGoal && app.profile.birth_date && app.profile.sex && app.profile.height_cm && app.profile.activity_level && currentKg && (
          <EditGoal currentKg={currentKg} onDone={(msg) => { setEditGoal(false); setNotice(msg); }} />
        )}
        <Button variant="secondary" onClick={() => setEditProfile((v) => !v)}>
          {editProfile ? 'Close profile' : 'Edit profile'}
        </Button>
        {editProfile && <EditProfile onDone={(msg) => { setEditProfile(false); setNotice(msg); }} />}
      </div>
      <Notice className="mt-3">{notice}</Notice>
      <WeighInSheet open={weighing} onClose={() => setWeighing(false)} lastKg={currentKg} />
    </Screen>
  );
}

function Line({ label, sub, value, strong }: { label: string; sub: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-separator py-2 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className={strong ? 'block text-base font-semibold' : 'block text-base'}>{label}</span>
        <span className="block text-[13px] leading-snug text-ink2">{sub}</span>
      </span>
      <span className={strong ? 'text-[19px] font-medium tnum' : 'text-[15px] tnum'}>{value}</span>
    </div>
  );
}

function EditGoal({ currentKg, onDone }: { currentKg: number; onDone: (msg: string) => void }) {
  const app = useApp();
  const p = app.profile;
  const [g, setG] = useState<GoalValues>(() => ({
    target_kg: app.goal ? String(app.goal.target_weight_kg) : '',
    target_date: app.goal?.target_date ?? addDays(app.today, 84),
    own_target: p.energy_target_override_kcal != null,
    own_target_value: p.energy_target_override_kcal ? String(Math.round(kcalIn(p.energy_target_override_kcal, p.energy_unit))) : '',
  }));
  const changed = !app.goal || Number(g.target_kg) !== app.goal.target_weight_kg || g.target_date !== app.goal.target_date;
  // A dismissed warning doesn't come back unless the goal changes.
  const [dismissed, setDismissed] = useState<WarningKey[]>(() => (changed ? [] : (app.goal?.warnings_dismissed ?? [])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ctx = {
    birthDate: p.birth_date!,
    sex: p.sex!,
    heightCm: p.height_cm!,
    activityLevel: p.activity_level!,
    currentKg,
    today: app.today,
    ratePct: p.warn_rate_pct_per_week,
    floorKcal: p.warn_floor_kcal,
    unit: p.energy_unit,
  };
  const evaluation = evaluateGoal(g, ctx, dismissed);

  async function save() {
    if (!evaluation.check) return setError('Add a goal weight and date.');
    if (evaluation.check.refusal) return setError('Choose a new date or weight first.');
    if (evaluation.check.warnings.length) return setError('Continue anyway, or change the goal.');
    setSaving(true);
    try {
      if (changed) {
        await saveGoal({ start_weight_kg: currentKg, start_date: app.today, target_weight_kg: Number(g.target_kg.replace(',', '.')), target_date: g.target_date, warnings_dismissed: dismissed });
      }
      await saveProfile({ energy_target_override_kcal: evaluation.overrideKcal ? Math.round(evaluation.overrideKcal) : null });
      await app.reload(['goal', 'profile']);
      onDone('Goal saved. Your target has been worked out again.');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <GoalForm
        value={g}
        onChange={(v) => {
          if (v.target_kg !== g.target_kg || v.target_date !== g.target_date) setDismissed([]);
          setG(v);
        }}
        ctx={ctx}
        evaluation={evaluation}
        onContinueAnyway={(k) => setDismissed((d) => [...d, k])}
      />
      <Notice tone="warn">{error}</Notice>
      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save goal'}
      </Button>
    </div>
  );
}

function EditProfile({ onDone }: { onDone: (msg: string) => void }) {
  const app = useApp();
  const p = app.profile;
  const [v, setV] = useState<ProfileValues>({
    display_name: p.display_name ?? '',
    birth_date: p.birth_date ?? '',
    sex: p.sex ?? '',
    height_cm: p.height_cm ? String(p.height_cm) : '',
    activity_level: p.activity_level ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const err = profileErrors(v, false);
    if (err) return setError(err);
    try {
      await saveProfile({ display_name: v.display_name.trim() || null, birth_date: v.birth_date, sex: v.sex || null, height_cm: Number(v.height_cm), activity_level: v.activity_level || null });
      await app.reload(['profile']);
      onDone('Profile saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    }
  }
  return (
    <div className="flex flex-col gap-3 py-2">
      <ProfileForm value={v} onChange={setV} withWeight={false} />
      <Notice tone="warn">{error}</Notice>
      <Button onClick={save}>Save profile</Button>
    </div>
  );
}
