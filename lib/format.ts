// Number formats, en-AU. Energy is stored in kJ and shown in the person's unit (kcal by default).

import { grams, int, one } from '@/design/components/format';
import { kjToKcal, NUTRIENT_BY_KEY, saltFromSodiumMg, type NutrientKey } from './nutrients';
import type { EnergyUnit } from './types';

export { grams, int, one };

/** kJ → the display unit. */
export const energyIn = (kj: number, unit: EnergyUnit) => (unit === 'kj' ? kj : kjToKcal(kj));
/** kcal → the display unit (targets are worked out in kcal). */
export const kcalIn = (kcal: number, unit: EnergyUnit) => (unit === 'kj' ? kcal * 4.184 : kcal);
export const unitLabel = (unit: EnergyUnit) => (unit === 'kj' ? 'kJ' : 'kcal');
export const unitCaps = (unit: EnergyUnit) => (unit === 'kj' ? 'KJ' : 'KCAL');

/** "8 kcal", "1,620 kJ", "–" for unknown. */
export function energyText(kj: number | null, unit: EnergyUnit, withUnit = true): string {
  if (kj == null) return '–';
  const n = int(energyIn(kj, unit));
  return withUnit ? `${n} ${unitLabel(unit)}` : n;
}

/** Salt in brackets beside sodium: "(3.1 g salt)", or "(0.02 g salt)" for small amounts. */
export function saltText(mg: number): string {
  const g = saltFromSodiumMg(mg);
  const s = g > 0 && g < 0.1 ? (Math.round(g * 100) / 100).toFixed(2) : one(g);
  return `${s} g salt`;
}

/** A nutrient amount for display with its unit: "0.6 g", "1,240 mg", "–". */
export function nutrientText(key: NutrientKey, value: number | null, unit: EnergyUnit = 'kcal'): string {
  if (value == null) return '–';
  if (key === 'energy_kj') return energyText(value, unit);
  if (key === 'sodium_mg') return `${int(value)} mg`;
  return `${value >= 100 ? int(value) : one(value)} g`;
}

/** Just the number for a nutrient (no unit). */
export function nutrientNumber(key: NutrientKey, value: number | null, unit: EnergyUnit = 'kcal'): string {
  if (value == null) return '–';
  if (key === 'energy_kj') return int(energyIn(value, unit));
  if (key === 'sodium_mg') return int(value);
  return value >= 100 ? int(value) : one(value);
}

export const nutrientUnit = (key: NutrientKey, unit: EnergyUnit = 'kcal') =>
  key === 'energy_kj' ? unitLabel(unit) : NUTRIENT_BY_KEY[key].unit;

/** Amount shown on log rows: "45 g", "220 ml". */
export const amountText = (amount: number, unit: 'g' | 'ml') => `${amount >= 100 || Number.isInteger(amount) ? int(amount) : one(amount)} ${unit}`;

/** Weight in kg to one decimal: "86.6". */
export const kg = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

const timeFmt = new Map<string, Intl.DateTimeFormat>();
/** "12:40" in a time zone, 24-hour as designed. */
export function clock(iso: string | Date, tz: string): string {
  let f = timeFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
    timeFmt.set(tz, f);
  }
  return f.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** Strip em dashes from any AI-produced text (house style: never an em dash). */
export const noEmDash = (s: string) => s.replace(/\s*—\s*/g, ', ');
