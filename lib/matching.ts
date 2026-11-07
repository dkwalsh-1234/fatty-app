// The pure half of AI-first matching (lib/ai/match.ts): one shape for what the AI understood from
// typed text or a photo, how each food its searches found is described to it, and turning its pick
// into a meal confirm row. Values only ever come from the picked food. Shared by the server and tests.

import { unitOptions } from './amount';
import type { MealPhotoResult, PickResult, TextParseResult } from './ai/schemas';
import type { Candidate, DraftItem } from './drafts';
import { int } from './format';
import { SOURCE_TAG, type Food, type Measure } from './types';

/** One food the person ate, as the first AI pass understood it. */
export interface Understood {
  display_name: string;
  description: string;
  searches: string[];
  /** Grams or ml they gave, or the grams a photo shows. */
  amount: number | null;
  unit: 'g' | 'ml' | null;
  count: number | null;
  count_noun: string | null;
  typical_grams: number | null;
  /** The amount was estimated from a photo: it stands, and is marked estimated. */
  fromPhoto: boolean;
  confidence: DraftItem['confidence'];
  suggested: boolean;
  part_of: string | null;
}

const positive = (n: number | null | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : null);
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s*[—–]\s*/g, ', ').trim();

export function fromText(i: TextParseResult['items'][number]): Understood {
  return {
    display_name: clean(i.display_name) || clean(i.text),
    description: clean(i.description) || clean(i.text),
    searches: [...(i.searches ?? []), i.text].map(clean),
    amount: positive(i.amount),
    unit: positive(i.amount) ? (i.unit ?? 'g') : null,
    count: positive(i.count),
    count_noun: i.count_noun,
    typical_grams: positive(i.typical_grams),
    fromPhoto: false,
    confidence: null,
    suggested: false,
    part_of: clean(i.part_of) || null,
  };
}

export function fromPhoto(i: MealPhotoResult['items'][number]): Understood {
  return {
    display_name: clean(i.display_name) || clean(i.name),
    description: clean(i.description) || clean(i.name),
    searches: [...(i.searches ?? []), i.name].map(clean),
    amount: positive(i.grams) ? Math.round(i.grams) : null,
    unit: positive(i.grams) ? 'g' : null,
    count: null,
    count_noun: null,
    typical_grams: null,
    fromPhoto: true,
    confidence: i.confidence,
    suggested: i.suggested,
    part_of: clean(i.part_of) || null,
  };
}

/** The searches to run for an item: the AI's, then its own words, without repeats. At most five. */
export function searchesFor(u: Understood): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...u.searches, u.display_name]) {
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 5);
}

/** A measure the AI can count in: "egg = 49 g", "regular cup = 280 ml (typical)", "serve = 45 g". */
export interface PickMeasure {
  label: string;
  grams: number;
  hint: string;
  estimate: boolean;
}

export type UnitFoodRow = Pick<Food, 'name' | 'display_name' | 'source' | 'is_liquid' | 'density_g_per_ml' | 'serving_g' | 'pack_g' | 'total_weight_g' | 'serves'>;

/** Every measure a food can be counted in, as on the amount sheet, plus its serve and whole pack. */
export function pickMeasures(food: UnitFoodRow, measures: Measure[]): PickMeasure[] {
  const out: PickMeasure[] = unitOptions(food, measures)
    .filter((u) => u.kind === 'measure')
    .map((u) => ({ label: u.label, grams: u.grams, hint: u.hint ?? `${int(u.grams)} g`, estimate: u.estimate }));
  const add = (label: string, grams: number | null) => {
    if (grams && grams > 0 && !out.some((m) => m.label === label)) out.push({ label, grams, hint: `${int(grams)} g`, estimate: false });
  };
  add('serve', food.serving_g);
  add('whole pack', food.pack_g);
  return out.slice(0, 10);
}

/** A food a search found for an item: the candidate the confirm screen shows, plus what the AI is told. */
export interface PoolFood {
  candidate: Candidate;
  measures: PickMeasure[];
  /** How many times you've logged it. */
  logged: number;
}

export const letter = (i: number) => String.fromCharCode(65 + i);
const fromLetter = (s: string | null | undefined) => {
  const t = (s ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  return t.length === 1 ? t.charCodeAt(0) - 65 : -1;
};

function amountLine(u: Understood): string {
  if (u.amount && u.fromPhoto) return `about ${int(u.amount)} g, estimated from the photo`;
  if (u.amount) return `${int(u.amount)} ${u.unit ?? 'g'}`;
  if (u.count) return `${u.count} × ${u.count_noun ?? 'one'}`;
  if (u.typical_grams) return `not given; a typical serve is about ${int(u.typical_grams)} g`;
  return 'not given';
}

/** One food as the AI sees it: "A. Egg, chicken, whole, poached · FSANZ · 590 kJ per 100 g · measures: egg = 49 g". */
export function describeFood(i: number, f: PoolFood): string {
  const c = f.candidate;
  const parts = [
    `${letter(i)}. ${c.display_name ?? c.name}${c.brand ? ` (${c.brand})` : ''}`,
    SOURCE_TAG[c.source as keyof typeof SOURCE_TAG] ?? c.source,
    c.energy_kj == null ? 'energy unknown' : `${int(c.energy_kj)} kJ per 100 g`,
  ];
  if (f.logged > 0) parts.push(`logged before ${f.logged}×`);
  if (f.measures.length) parts.push(`measures: ${f.measures.map((m) => `${m.label} = ${m.hint}${m.estimate ? ' (typical)' : ''}`).join('; ')}`);
  return parts.join(' · ');
}

/** The items block of the pick prompt. */
export function describeItems(items: Understood[], pools: PoolFood[][]): string {
  return items
    .map((u, n) => {
      const head = `Item ${n + 1}: ${u.display_name} (${u.description}). Amount: ${amountLine(u)}.${u.suggested ? ' A likely hidden fat.' : ''}`;
      const foods = pools[n].length ? pools[n].map((f, i) => `  ${describeFood(i, f)}`).join('\n') : '  No foods found.';
      return `${head}\n${foods}`;
    })
    .join('\n\n');
}

/** A measure as the AI may write it back: "egg", "1 egg", "egg = 49 g", "Slice (typical)" → "egg"/"slice". */
const measureKey = (s: string) =>
  s
    .toLowerCase()
    .split('=')[0]
    .replace(/\(typical\)/g, '')
    .replace(/^\s*1\s+/, '')
    .trim();

const MAX_GRAMS = 5000;
const sane = (g: number | null) => (g != null && Number.isFinite(g) && g > 0 && g <= MAX_GRAMS ? Math.round(g * 10) / 10 : null);

/**
 * The AI's choice as a meal confirm row: the chosen food first, then its alternatives and the rest
 * of what search found (for Swap). Amounts the person gave, or a photo showed, always stand; a count
 * becomes that many of the chosen food's measure. A pick that isn't on the list is no pick.
 */
export function applyPick(u: Understood, pool: PoolFood[], pick: PickResult['items'][number] | undefined, key: string): DraftItem {
  const at = (s: string | null | undefined) => pool[fromLetter(s)] as PoolFood | undefined;
  const chosen = at(pick?.food);
  const order: PoolFood[] = [];
  for (const f of [chosen, ...(pick?.alternatives ?? []).map(at), ...pool]) if (f && !order.includes(f)) order.push(f);

  let grams: number | null = null;
  let estimate = false;
  let note: string | null = null;
  let entered: DraftItem['entered'] = null;
  const c = chosen?.candidate;
  if (u.amount && u.unit === 'ml') {
    grams = sane(u.amount * (c?.density_g_per_ml ?? 1));
    estimate = !c?.density_g_per_ml;
    entered = { amount: u.amount, unit: 'ml', measure: null };
  } else if (u.amount) {
    grams = sane(u.amount);
    estimate = u.fromPhoto;
  } else {
    const m = chosen && pick?.measure ? chosen.measures.find((x) => measureKey(x.label) === measureKey(pick.measure!)) : undefined;
    const count = positive(pick?.count) ?? (m ? (u.count ?? 1) : null);
    if (m && count) {
      grams = sane(m.grams * count);
      estimate = m.estimate;
      entered = { amount: count, unit: 'measure', measure: m.label };
    } else if (chosen && sane(pick?.grams ?? null)) {
      grams = sane(pick!.grams);
      estimate = true;
      if (u.count) note = `${u.count} × ${u.count_noun ?? 'one'}`;
    } else if (u.typical_grams) {
      grams = sane(u.typical_grams);
      estimate = true;
    }
  }
  if (grams == null) entered = null;

  // The less sure of the two: what the photo showed, and whether the food is the same.
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const sure = [u.confidence, chosen ? pick?.confidence : null].filter((c): c is NonNullable<DraftItem['confidence']> => !!c);
  const confidence = sure.length ? sure.reduce((a, b) => (rank[b] < rank[a] ? b : a)) : null;
  return {
    key,
    label: u.display_name,
    query: u.searches[0] ?? u.display_name,
    grams,
    estimate,
    confidence,
    suggested: u.suggested,
    note,
    candidates: order.slice(0, 6).map((f) => f.candidate),
    tier: null,
    splitFrom: u.part_of,
    entered,
    noMatch: !chosen,
  };
}
