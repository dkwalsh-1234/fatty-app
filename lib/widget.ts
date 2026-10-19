// The summary the Android widget shows (docs/android-bridge.md → WidgetSummary).

import { targetState } from '@/design/components/TargetBar';
import type { WidgetSummary } from './bridge';
import type { DayView } from './day';
import { grams, int, saltText, unitCaps } from './format';
import { NUTRIENT_BY_ID } from './nutrients';
import type { Profile } from './types';

export function widgetSummary(day: DayView, profile: Profile, baseUrl: string): WidgetSummary | null {
  if (!day.ring) return null;
  const nutrients = (profile.widget_nutrients ?? ['protein', 'sat_fat', 'sodium']).slice(0, 3).map((id) => {
    const info = NUTRIENT_BY_ID[id];
    const row = day.targetRows.find((r) => r.info.id === id);
    const value = row ? row.value : day.totals.values[info.key];
    const fmt = (n: number) => (info.unit === 'mg' ? int(n) : grams(n));
    if (info.key === 'sodium_mg' && !row) {
      return { name: info.label, value: value == null ? '–' : int(value), unit: 'mg', caption: value == null ? null : saltText(value), tone: 'neutral' as const };
    }
    if (!row) return { name: info.label, value: value == null ? '–' : fmt(value), unit: info.unit, caption: null, tone: 'neutral' as const };
    const st = targetState({ value: row.value, direction: row.direction, min: row.min, max: row.max, unit: info.unit, format: fmt });
    const of = row.direction === 'range' ? `/ ${fmt(row.min ?? 0)}–${fmt(row.max)} ${info.unit}` : `/ ${fmt(row.max)} ${info.unit}`;
    return {
      name: info.label,
      value: (st.tone === 'over' ? '▲ ' : '') + (value == null ? '–' : fmt(value)),
      unit: of,
      caption: row.direction === 'noMoreThan' ? st.caption.replace(/^▲ /, '') : row.direction === 'range' ? st.caption : null,
      tone: st.tone,
    };
  });
  return {
    date: day.date,
    time_zone: profile.time_zone,
    unit: unitCaps(profile.energy_unit) as 'KCAL' | 'KJ',
    target: Math.round(day.ring.target),
    base: Math.round(day.ring.base),
    eaten: {
      protein: Math.round(day.eaten.protein),
      carbs: Math.round(day.eaten.carbs),
      fat: Math.round(day.eaten.fat),
      other: Math.round(day.eaten.other),
    },
    remaining: Math.round(day.ring.target - day.eatenTotal),
    activity: day.ring.activity,
    nutrients,
    base_url: baseUrl,
  };
}
