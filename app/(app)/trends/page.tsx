'use client';

// Trends: 7- and 30-day daily averages per nutrient against targets. A plain table for v1.
// Days with nothing logged are left out of the average; gaps are shown, never counted as zero.

import { useEffect, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { targetState } from '@/design/components/TargetBar';
import { Card, DashedChip, Notice, Screen, ScreenTitle, Segmented, Spinner, TopBar } from '@/components/ui';
import { addDays } from '@/lib/dates';
import { dailyTotals, type DailyTotalRow } from '@/lib/data';
import { energyIn, grams, int, unitLabel } from '@/lib/format';
import { NUTRIENTS } from '@/lib/nutrients';

export default function TrendsPage() {
  const app = useApp();
  const [days, setDays] = useState<'7' | '30'>('7');
  const [loaded, setLoaded] = useState<{ key: string; rows: DailyTotalRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${days}:${app.today}`;
  const rows = loaded?.key === key ? loaded.rows : null;

  useEffect(() => {
    let live = true;
    dailyTotals(addDays(app.today, -(Number(days) - 1)), app.today)
      .then((r) => live && setLoaded({ key: `${days}:${app.today}`, rows: r }))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [days, app.today]);

  const unit = app.profile.energy_unit;
  const logged = rows?.filter((r) => r.entries > 0) ?? [];

  return (
    <Screen dock={false}>
      <TopBar back="/" />
      <ScreenTitle sub="Daily averages over the days you logged anything.">Trends</ScreenTitle>
      <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />
      <Notice tone="warn" className="mt-3">
        {error}
      </Notice>
      {!rows ? (
        <div className="mt-10 flex justify-center">
          <Spinner />
        </div>
      ) : logged.length === 0 ? (
        <p className="mx-1 mt-4 text-[15px] text-ink2">Nothing logged in the last {days} days.</p>
      ) : (
        <Card className="mt-3 py-2">
          <div className="grid grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-x-2 pb-1 pt-2 text-xs text-ink2">
            <span>Nutrient</span>
            <span className="text-right">Daily average</span>
            <span className="text-right">Target</span>
          </div>
          {NUTRIENTS.map((n) => {
            const known = logged.filter((r) => r.values[n.key] != null);
            const avgRaw = known.length ? known.reduce((s, r) => s + (r.values[n.key] as number), 0) / logged.length : null;
            const avg = avgRaw == null ? null : n.key === 'energy_kj' ? energyIn(avgRaw, unit) : avgRaw;
            const gaps = logged.reduce((s, r) => s + (r.missing[n.key] ?? 0), 0);
            const t = app.targets.find((x) => x.nutrient === n.id);
            const fmt = n.unit === 'mg' || n.key === 'energy_kj' ? int : grams;
            const u = n.key === 'energy_kj' ? unitLabel(unit) : n.unit;
            const st =
              t && avg != null
                ? targetState({ value: avg, direction: t.direction === 'min' ? 'atLeast' : t.direction === 'max' ? 'noMoreThan' : 'range', min: t.low ?? 0, max: (t.direction === 'min' ? t.low : t.high) ?? 0, unit: u, format: fmt })
                : null;
            return (
              <div key={n.key} className="grid min-h-[52px] grid-cols-[minmax(0,1fr)_96px_minmax(0,1fr)] items-center gap-x-2 border-t border-separator py-1.5">
                <span className="flex flex-wrap items-center gap-1.5 text-[15px]">
                  {n.label === 'Dietary fibre' ? 'Fibre' : n.label}
                  {gaps > 0 && <DashedChip title={`${gaps} entries had no value`}>incomplete · {gaps}</DashedChip>}
                </span>
                <span className="text-right text-[16px] font-medium tnum">{avg == null ? '–' : `${fmt(avg)} ${u}`}</span>
                <span className={`text-right text-[13px] leading-snug tnum ${st && st.tone !== 'neutral' ? 'text-warn-text' : 'text-ink2'}`}>
                  {t ? (
                    <>
                      {t.direction === 'min' ? `at least ${fmt(t.low ?? 0)}` : t.direction === 'max' ? `no more than ${fmt(t.high ?? 0)}` : `${fmt(t.low ?? 0)}–${fmt(t.high ?? 0)}`}
                      {st && <span className="block">{st.reached && t.direction === 'min' ? '✓ ' : ''}{st.caption}</span>}
                    </>
                  ) : n.key === 'energy_kj' ? (
                    'moves with your goal'
                  ) : (
                    '–'
                  )}
                </span>
              </div>
            );
          })}
          <p className="pb-1 pt-2 text-[12px] text-ink2">{logged.length} of {days} days logged.</p>
        </Card>
      )}
    </Screen>
  );
}
