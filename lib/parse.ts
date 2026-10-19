// Parsing typed amounts: the search box ("45 salad", "salad 45g", "250ml milk") and the Type box
// ("45 g salad, 2 eggs, flat white, 30 g almonds"). No AI here; this is the local parse.

export type Unit = 'g' | 'ml';

export interface ParsedAmount {
  /** The food words, with the amount stripped. */
  text: string;
  /** Grams or millilitres, when a weight or volume was given (a bare number counts as grams). */
  amount: number | null;
  unit: Unit | null;
  /** A small bare whole number before a noun reads as a count ("2 eggs"), converted with household measures. */
  count: number | null;
}

const UNIT_WORDS: Record<string, { unit: Unit; factor: number }> = {
  g: { unit: 'g', factor: 1 },
  gm: { unit: 'g', factor: 1 },
  gms: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  grams: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
  kgs: { unit: 'g', factor: 1000 },
  ml: { unit: 'ml', factor: 1 },
  mls: { unit: 'ml', factor: 1 },
  millilitre: { unit: 'ml', factor: 1 },
  millilitres: { unit: 'ml', factor: 1 },
  milliliter: { unit: 'ml', factor: 1 },
  milliliters: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
  litre: { unit: 'ml', factor: 1000 },
  litres: { unit: 'ml', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 },
  liters: { unit: 'ml', factor: 1000 },
  // Ounces are by weight here; a coffee's "8 oz" cup comes out close either way (227 g vs 237 ml).
  oz: { unit: 'g', factor: 28.35 },
  ounce: { unit: 'g', factor: 28.35 },
  ounces: { unit: 'g', factor: 28.35 },
};

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT = String.raw`(kgs?|gms?|grams?|g|mls?|millilit(?:re|er)s?|lit(?:re|er)s?|l|oz|ounces?)`;
const LEADING_UNIT = new RegExp(String.raw`^\s*${NUM}\s*${UNIT}\b\s*(?:of\s+)?(.+)$`, 'i');
const LEADING_BARE = new RegExp(String.raw`^\s*${NUM}\s+(?:x\s+)?(.+)$`, 'i');
const TRAILING = new RegExp(String.raw`^(.+?)[\s,]+${NUM}\s*${UNIT}?\s*$`, 'i');

/** The largest bare whole number read as a count rather than grams. */
const MAX_COUNT = 10;

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5, couple: 2,
};
const WORD_COUNT = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|half(?:\s+a)?|a\s+couple\s+of|couple\s+of)\s+(.+)$/i;

const toNumber = (s: string) => Number(s.replace(',', '.'));

export function parseAmount(input: string): ParsedAmount {
  const raw = input.trim();
  let m = raw.match(LEADING_UNIT);
  if (m) {
    const u = UNIT_WORDS[m[2].toLowerCase()];
    return { text: m[3].trim(), amount: toNumber(m[1]) * u.factor, unit: u.unit, count: null };
  }
  m = raw.match(LEADING_BARE);
  if (m) {
    const n = toNumber(m[1]);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_COUNT) return { text: m[2].trim(), amount: null, unit: null, count: n };
    return { text: m[2].trim(), amount: n, unit: 'g', count: null };
  }
  m = raw.match(TRAILING);
  if (m) {
    const u = m[3] ? UNIT_WORDS[m[3].toLowerCase()] : UNIT_WORDS.g;
    return { text: m[1].trim(), amount: toNumber(m[2]) * u.factor, unit: u.unit, count: null };
  }
  const w = raw.match(WORD_COUNT);
  if (w) {
    const word = w[1].toLowerCase().split(/\s+/)[0] === 'a' && /couple/i.test(w[1]) ? 'couple' : w[1].toLowerCase().split(/\s+/)[0];
    return { text: w[2].trim(), amount: null, unit: null, count: NUMBER_WORDS[word] ?? 1 };
  }
  return { text: raw, amount: null, unit: null, count: null };
}

/** The search box: "45 salad", "salad 45g", "250ml milk". */
export const parseSearch = parseAmount;

// Typed meal text --------------------------------------------------------------------------------

export interface TextItem extends ParsedAmount {
  /** What the person typed for this item. */
  raw: string;
}

/** Split typed or dictated text into items. "45 g salad, 2 eggs and a flat white" → three items. */
export function splitItems(input: string): string[] {
  return input
    .split(/\s*(?:,|;|\n|\+|&|\band\b|\bplus\b)\s*/i)
    .map((s) => s.trim().replace(/[.!]$/, ''))
    .filter(Boolean);
}

export function parseText(input: string): TextItem[] {
  return splitItems(input).map((raw) => ({ raw, ...parseAmount(raw) }));
}

/** Every item has an explicit weight or volume, so no AI is needed to work out amounts. */
export const allHaveAmounts = (items: TextItem[]) => items.length > 0 && items.every((i) => i.amount != null);
