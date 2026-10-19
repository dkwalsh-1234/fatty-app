'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useDay } from '@/components/app/AppProvider';
import { TodayView } from '@/components/today/TodayView';
import { WeighInSheet } from '@/components/app/WeighInSheet';
import { ActionSheet, Notice, Spinner } from '@/components/ui';
import { updateWidget } from '@/lib/bridge';
import { addDays, daysBetween, dayTitle, longDate, MEAL_LABEL, type Meal } from '@/lib/dates';
import { copyEntries, dayEntries } from '@/lib/data';
import { weightOn, type DayView } from '@/lib/day';
import { announceLogChanged, syncToHealth } from '@/lib/logging';
import { NUTRIENT_BY_ID, type NutrientKey } from '@/lib/nutrients';
import { widgetSummary } from '@/lib/widget';

export default function TodayPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Today />
    </Suspense>
  );
}

function Loading() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Spinner />
    </div>
  );
}

function Today() {
  const app = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('d');
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && daysBetween(requested, app.today) >= 0 ? requested : app.today;
  const { day, entries, error } = useDay(date);
  const [weighing, setWeighing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [group, setGroup] = useState<DayView['groups'][number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = useCallback(
    (d: string) => {
      if (daysBetween(d, app.today) < 0) return;
      router.replace(d === app.today ? '/' : `/?d=${d}`, { scroll: false });
    },
    [app.today, router],
  );

  // Swipe left and right to move between days; arrow keys on a laptop.
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [role="dialog"]')) return;
      if (e.key === 'ArrowLeft') go(addDays(date, -1));
      if (e.key === 'ArrowRight') go(addDays(date, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [date, go]);

  // Keep the widget in step with today.
  useEffect(() => {
    if (!day || date !== app.today) return;
    const s = widgetSummary(day, app.profile, window.location.origin);
    if (s) updateWidget(s);
  }, [day, date, app.today, app.profile]);

  // Anything saved while the wrapper couldn't reach Health Connect gets another go.
  useEffect(() => {
    const unsynced = entries.filter((e) => !e.hc_synced_at);
    if (unsynced.length) void syncToHealth(unsynced, app.profile.time_zone);
  }, [entries, app.profile.time_zone]);

  const weightKg = useMemo(
    () => weightOn(app.weighIns, date, app.profile.time_zone) ?? app.goal?.start_weight_kg ?? null,
    [app.weighIns, app.goal, date, app.profile.time_zone],
  );
  const missingKeys = useMemo<NutrientKey[]>(
    () => ['energy_kj', ...app.targets.map((t) => NUTRIENT_BY_ID[t.nutrient]?.key).filter((k): k is NutrientKey => !!k && k !== 'energy_kj')],
    [app.targets],
  );

  const logHref = (route: 'scan' | 'photo' | 'search' | 'type') => `/log/${route}${date === app.today ? '' : `?d=${date}`}`;

  async function copyGroup(fromDate: string, meal: Meal, toDate: string) {
    try {
      const src = (await dayEntries(fromDate)).filter((e) => e.meal === meal);
      if (!src.length) {
        setNotice(`Nothing logged for ${MEAL_LABEL[meal].toLowerCase()} that day.`);
        return;
      }
      const saved = await copyEntries(src, toDate, meal, app.profile.time_zone);
      announceLogChanged();
      void syncToHealth(saved, app.profile.time_zone);
      setNotice(`Copied ${saved.length} ${saved.length === 1 ? 'item' : 'items'} to ${MEAL_LABEL[meal].toLowerCase()}${toDate === app.today ? ' today' : ''}.`);
      if (toDate !== date) go(toDate);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't copy.");
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[480px] p-6">
        <Notice tone="warn">{error}</Notice>
      </div>
    );
  }
  if (!day) return <Loading />;

  const groupActions = group
    ? [
        ...(date !== app.today && group.entries.length
          ? [{ label: `Copy to today's ${MEAL_LABEL[group.meal].toLowerCase()}`, onClick: () => copyGroup(date, group.meal, app.today) }]
          : []),
        {
          label: `Copy ${dayTitle(addDays(date, -1), app.today).toLowerCase()}'s ${MEAL_LABEL[group.meal].toLowerCase()} here`,
          onClick: () => copyGroup(addDays(date, -1), group.meal, date),
        },
        ...(group.entries.length
          ? [{ label: 'Save these as a meal', onClick: () => router.push(`/meals/new?fromDate=${date}&meal=${group.meal}`) }]
          : []),
      ]
    : [];

  return (
    <div
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 50) go(addDays(date, dx > 0 ? -1 : 1));
      }}
    >
      <TodayView
        day={day}
        title={dayTitle(date, app.today)}
        capsDate={longDate(date).toUpperCase()}
        weightKg={weightKg}
        unit={app.profile.energy_unit}
        activityLevel={app.profile.activity_level}
        missingKeys={missingKeys}
        notice={notice ? <Notice className="py-1">{notice}</Notice> : null}
        handlers={{
          onWeigh: () => setWeighing(true),
          onMenu: () => setMenu(true),
          onEntry: (entry) => app.openAmount({ kind: 'edit', entry }),
          onGroupMenu: setGroup,
          logHref,
        }}
      />
      <WeighInSheet open={weighing} onClose={() => setWeighing(false)} lastKg={weightKg} />
      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="Fatty"
        actions={[
          { label: 'Meals', onClick: () => router.push('/meals') },
          { label: 'Goal and weight', onClick: () => router.push('/goal') },
          { label: 'Trends', onClick: () => router.push('/trends') },
          { label: 'Settings', onClick: () => router.push('/settings') },
          ...(app.isAdmin ? [{ label: 'Admin', onClick: () => router.push('/admin') }] : []),
          { label: 'About and data credits', onClick: () => router.push('/about') },
        ]}
      />
      <ActionSheet open={!!group} onClose={() => setGroup(null)} title={group ? MEAL_LABEL[group.meal] : ''} actions={groupActions} />
    </div>
  );
}
