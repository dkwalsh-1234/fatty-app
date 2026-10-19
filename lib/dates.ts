// Local-day handling. Days belong to the person's own time zone (Daniel's is Australia/Sydney), never UTC.
// Dates are plain 'YYYY-MM-DD' strings; instants are Date objects.

export const DEFAULT_TIME_ZONE = 'Australia/Sydney';

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, d: Date) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local calendar date of an instant in a time zone. */
export function localDate(tz: string, at: Date = new Date()): string {
  const p = parts(tz, at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Local wall-clock time "HH:MM". */
export function localTime(tz: string, at: Date = new Date()): string {
  const p = parts(tz, at);
  return `${pad(p.h)}:${pad(p.min)}`;
}

/** Offset of the zone from UTC at an instant, in ms (Sydney summer = +11 h). */
function offsetMs(tz: string, at: Date): number {
  const p = parts(tz, at);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a local wall-clock time happens in a zone. Handles daylight saving. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm || 0, 0);
  let t = guess - offsetMs(tz, new Date(guess));
  // Second pass settles the DST edge where the offset at the guess differs from the offset at the answer.
  t = guess - offsetMs(tz, new Date(t));
  return new Date(t);
}

/** Start (inclusive) and end (exclusive) instants of a local day. */
export function dayBounds(tz: string, date: string): { start: Date; end: Date } {
  return { start: zonedToUtc(date, '00:00', tz), end: zonedToUtc(addDays(date, 1), '00:00', tz) };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Age in whole years on a date. */
export function ageOn(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}

const longFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortYearFmt = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const utcNoon = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

/** "MONDAY 19 OCTOBER" (the Today header's caps line, before upper-casing). */
export const longDate = (date: string) => longFmt.format(utcNoon(date)).replace(',', '');
/** "20 Dec" */
export const shortDate = (date: string) => shortFmt.format(utcNoon(date)).replace('.', '');
/** "20 Dec 2026" */
export const shortDateYear = (date: string) => shortYearFmt.format(utcNoon(date)).replace('.', '');

/** "Today", "Yesterday", or a weekday and date for anything further back. */
export function dayTitle(date: string, today: string): string {
  const diff = daysBetween(date, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-AU', { weekday: 'long', timeZone: 'UTC' }).format(utcNoon(date));
}

// Meals ---------------------------------------------------------------------------------------

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];
/** Display order on Today, as designed. */
export const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];
export const MEAL_LABEL: Record<Meal, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

export interface MealBoundary {
  from: string; // "HH:MM", local
  meal: Meal;
}

/** Default meal windows. Anything before the first boundary belongs to the last one (late snack). */
export const DEFAULT_MEAL_BOUNDARIES: MealBoundary[] = [
  { from: '04:00', meal: 'breakfast' },
  { from: '11:00', meal: 'lunch' },
  { from: '14:30', meal: 'snack' },
  { from: '17:00', meal: 'dinner' },
  { from: '21:00', meal: 'snack' },
];

export function mealForTime(time: string, boundaries: MealBoundary[] = DEFAULT_MEAL_BOUNDARIES): Meal {
  const sorted = [...boundaries].sort((a, b) => a.from.localeCompare(b.from));
  let meal = sorted[sorted.length - 1]?.meal ?? 'snack';
  for (const b of sorted) if (time >= b.from) meal = b.meal;
  return meal;
}
