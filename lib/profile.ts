import type { Profile } from './types';

const num = (v: unknown) => (v == null ? null : Number(v));

/** A profiles row as the app uses it (numerics parsed, defaults filled). */
export function toProfile(r: Record<string, unknown>): Profile {
  return {
    ...(r as unknown as Profile),
    height_cm: num(r.height_cm),
    energy_target_override_kcal: num(r.energy_target_override_kcal),
    warn_rate_pct_per_week: Number(r.warn_rate_pct_per_week ?? 1),
    warn_floor_kcal: num(r.warn_floor_kcal),
    time_zone: (r.time_zone as string) || 'Australia/Sydney',
    energy_unit: r.energy_unit === 'kj' ? 'kj' : 'kcal',
    widget_nutrients: (r.widget_nutrients as string[]) ?? ['protein', 'sat_fat', 'sodium'],
  };
}
