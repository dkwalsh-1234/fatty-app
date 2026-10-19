// AUSNUT 2023 (FSANZ): 3,741 foods as Australians eat them, 58 nutrients per 100 g, and 9,816 household
// measures. Daniel downloads three files from
// https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut/data-files into data/raw:
//   "AUSNUT 2023 - Food details.xlsx" (served as AUSNUT-2023-Food-details-4.xlsx),
//   "AUSNUT 2023 - Food nutrient profiles.xlsx", "AUSNUT 2023 - Food measures.xlsx".
//
// Measures ("AUSNUT 2023 – About the food measures", FSANZ 2025) come in two kinds:
// - densities, in g/mL: rows whose first description is "density", e.g. "Beef, steak, lean, raw | 44727 |
//   density | piece | 1.06". Almost every food has one, solids included, sometimes several by preparation
//   ("piece", "sliced or chopped"). They aren't measures to show; the food's density_g_per_ml is the
//   unqualified one, else the first listed.
// - food-specific measures in grams, e.g. "Mango, peeled, raw | 44339 | mango | medium | 294". These become
//   food_measures rows labelled "1 mango, medium", ranked in file order (first listed = 0).
// FSANZ says measures "are also provided in millilitres (mL) for liquids and semi-solids", so a food with a
// measure stated in mL (a Volume column, or "mL" in the measure text) is marked is_liquid. That includes some
// semi-solids such as yoghurt; the ml toggle there is harmless, since grams stay the default. If a food has
// no density row, its density comes from such a measure (grams ÷ mL).

import { basename } from 'node:path';
import {
  type Cell,
  type FileSpec,
  type ImportReport,
  KEY_PATTERN,
  SURVEY_ID_PATTERN,
  cleanKey,
  describeWorkbookHeaders,
  findColumn,
  headerList,
  loadFsanzFoods,
  locateFiles,
  missingFilesMessage,
  noTableMessage,
  normaliseHeader,
  positiveNumber,
  readWorkbook,
  round,
  tableWhere,
  tablesInWorkbook,
} from './fsanz-common';
import type { FileImportAdapter, FoodRow, MeasureRow } from './types';

export const AUSNUT_FILES: FileSpec[] = [
  {
    role: 'details',
    label: 'AUSNUT 2023 food details file ("AUSNUT 2023 - Food details.xlsx")',
    include: /\bausnut\b.*\bfood details?\b/,
    exclude: /supplement/,
  },
  {
    role: 'profiles',
    label: 'AUSNUT 2023 food nutrient profiles file ("AUSNUT 2023 - Food nutrient profiles.xlsx")',
    include: /\bausnut\b.*\bnutrient profiles?\b/,
    exclude: /supplement|dietary guidelines?|\badg\b|recipe/,
  },
  {
    role: 'measures',
    label: 'AUSNUT 2023 food measures file ("AUSNUT 2023 - Food measures.xlsx")',
    include: /\bausnut\b.*\bmeasures?\b/,
    exclude: /supplement/,
  },
];

const GRAMS_PATTERN = /^gram ?amount\b|^gram ?weight\b|^weight\b.*\(g\)$|^weight in grams\b|^grams?\b|^weight$/i;
const MEASURE_ID_PATTERN = /^measure ?(id|number|no\.?|code|key)$/i;
const QUANTITY_PATTERN = /^quantity\b|^amount$|^number of\b/i;
const VOLUME_PATTERN = /^volume\b/i;
const DESCRIPTION_PATTERN = /^(descript(ion|or)|measure ?descript(ion|or)|measure)\s*(\d*)$/i;
const ML_TEXT = /\b\d+(\.\d+)?\s*m[lL]\b|\bmillilit(re|er)s?\b|^m[lL]$/;

export interface AusnutLoadResult {
  foods: FoodRow[];
  measures: MeasureRow[];
  report: ImportReport;
}

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '0.33': '⅓', '0.67': '⅔' };

function formatQuantity(q: Cell): string | null {
  if (q === null || typeof q === 'boolean') return null;
  if (typeof q === 'number') {
    const s = String(round(q, 2));
    return FRACTIONS[s] ?? s;
  }
  const t = normaliseHeader(q);
  return t || null;
}

/** "1 cup, chopped", "1 mango, medium", "1 slice", "1 glass (250 mL)". */
export function measureLabel(quantity: Cell, descriptions: string[], volumeMl: number | null): string | null {
  const [first, ...rest] = descriptions;
  if (!first && quantity === null) return null;
  let q = formatQuantity(quantity);
  if (q === null && first && !/^[\d½¼¾⅓⅔⅛]/.test(first)) q = '1';
  let label = [q, first].filter(Boolean).join(' ');
  if (rest.length) label += `, ${rest.join(', ')}`;
  if (volumeMl !== null && !/\bm[lL]\b|millilit/i.test(label)) label += ` (${round(volumeMl, 1)} mL)`;
  return label.replace(/\s+/g, ' ').trim() || null;
}

function mlFromMeasure(descriptions: string[], volume: number | null, unitCells: string[]): number | null {
  if (volume !== null) return volume;
  for (const t of [...descriptions, ...unitCells]) {
    const m = t.match(/\b(\d+(?:\.\d+)?)\s*m[lL]\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Reads the three AUSNUT 2023 files in dir. Throws with a clear message if a file or required column is missing. */
export async function loadAusnut(dir: string): Promise<AusnutLoadResult> {
  const located = await locateFiles(dir, AUSNUT_FILES);
  if (located.missing.length) throw new Error(missingFilesMessage(dir, located.missing, located.all));

  const core = await loadFsanzFoods({
    source: 'ausnut',
    label: 'AUSNUT 2023',
    detailsFile: located.found.details,
    profilesFile: located.found.profiles,
    warnings: located.warnings,
  });
  const { foods, report, byKey, surveyIdToKey } = core;

  // Measures: a key (Public Food Key, or Survey ID mapped through the details file) and a gram amount.
  const file = located.found.measures;
  const wb = await readWorkbook(file);
  let tables = tablesInWorkbook(wb, file, { headerPatterns: [KEY_PATTERN, GRAMS_PATTERN] });
  let keyBySurveyId = false;
  if (!tables.length && surveyIdToKey.size) {
    tables = tablesInWorkbook(wb, file, { headerPatterns: [SURVEY_ID_PATTERN, GRAMS_PATTERN] });
    keyBySurveyId = tables.length > 0;
  }
  const table = tables[0];
  if (!table) {
    throw new Error(
      noTableMessage('AUSNUT 2023 food measures', file, wb, { headerPatterns: [KEY_PATTERN, GRAMS_PATTERN] }),
    );
  }
  const h = table.headers;
  const cKey = findColumn(h, [keyBySurveyId ? SURVEY_ID_PATTERN : KEY_PATTERN]);
  const cGrams = findColumn(h, [GRAMS_PATTERN]);
  const cId = findColumn(h, [MEASURE_ID_PATTERN]);
  const cQty = findColumn(h, [QUANTITY_PATTERN]);
  const cVol = findColumn(h, [VOLUME_PATTERN]);
  const cDesc = h
    .map((header, i) => ({ i, m: header.match(DESCRIPTION_PATTERN) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m![4] || 0) - Number(b.m![4] || 0))
    .map((x) => x.i);
  const cUnits = h.map((header, i) => (/^(unit|units|measure unit)$/i.test(header) ? i : -1)).filter((i) => i >= 0);
  if (!cDesc.length) {
    throw new Error(
      [
        `AUSNUT 2023 food measures: couldn't find a measure description column ("Description 1", "Descriptor 1" or "Measure") in ${tableWhere(table)}.`,
        'Headers found:',
        headerList(h),
      ].join('\n'),
    );
  }

  const measures: MeasureRow[] = [];
  const seenKeys = new Set<string>();
  const positionInFood = new Map<string, number>();
  const rankInFood = new Map<string, number>();
  const densities = new Map<string, { value: number; description: string }[]>();
  const mlDensity = new Map<string, number>();
  const liquidByMeasure = new Set<string>();
  let densityRows = 0;
  let unknownFood = 0;
  let noGrams = 0;
  let noLabel = 0;
  let duplicateIds = 0;

  for (const row of table.rows) {
    const rawKey = cleanKey(row.cells[cKey] ?? null)!;
    const key = keyBySurveyId ? surveyIdToKey.get(rawKey) : rawKey;
    if (!key || !byKey.has(key)) {
      unknownFood++;
      continue;
    }
    const position = (positionInFood.get(key) ?? 0) + 1;
    positionInFood.set(key, position);

    const descriptions = cDesc
      .map((i) => row.cells[i])
      .filter((c): c is string | number => c !== null && typeof c !== 'boolean')
      .map((c) => normaliseHeader(c))
      .filter(Boolean);
    const units = cUnits.map((i) => row.cells[i]).filter((c) => c !== null).map((c) => normaliseHeader(c));
    const amount = positiveNumber(row.cells[cGrams] ?? null);

    if (descriptions.some((d) => /^density$/i.test(d))) {
      densityRows++;
      if (amount !== null) {
        const list = densities.get(key) ?? [];
        list.push({ value: amount, description: descriptions.filter((d) => !/^density$/i.test(d)).join(', ') });
        densities.set(key, list);
      }
      continue;
    }

    if (amount === null) {
      noGrams++;
      continue;
    }
    const volume = cVol >= 0 ? positiveNumber(row.cells[cVol] ?? null) : null;
    const label = measureLabel(cQty >= 0 ? (row.cells[cQty] ?? null) : null, descriptions, volume);
    if (!label) {
      noLabel++;
      continue;
    }

    const id = cId >= 0 ? cleanKey(row.cells[cId] ?? null) : null;
    const sourceKey = `${key}#${id ?? position}`;
    if (seenKeys.has(sourceKey)) {
      duplicateIds++;
      continue;
    }
    seenKeys.add(sourceKey);

    const ml = mlFromMeasure(descriptions, volume, units);
    if (ml !== null || [...descriptions, ...units].some((t) => ML_TEXT.test(t))) liquidByMeasure.add(key);
    if (ml !== null && ml > 0 && !mlDensity.has(key)) {
      const d = round(amount / ml, 3);
      if (d > 0.3 && d < 3) mlDensity.set(key, d);
    }

    const rank = rankInFood.get(key) ?? 0;
    rankInFood.set(key, rank + 1);
    measures.push({ food_source_id: key, label, grams: amount, source: 'ausnut', source_key: sourceKey, rank });
  }

  let densityFromRows = 0;
  let densityFromMl = 0;
  for (const food of foods) {
    const key = food.source_id!;
    const list = densities.get(key);
    if (list?.length) {
      const pick = list.find((d) => !d.description) ?? list[0];
      food.density_g_per_ml = pick.value;
      densityFromRows++;
      (food.raw as Record<string, unknown>).densities = list.map((d) => ({
        g_per_ml: d.value,
        ...(d.description ? { description: d.description } : {}),
      }));
    } else if (food.density_g_per_ml == null && mlDensity.has(key)) {
      food.density_g_per_ml = mlDensity.get(key)!;
      densityFromMl++;
    }
    if (liquidByMeasure.has(key)) food.is_liquid = true;
  }

  report.files.measures = file;
  report.tables.push({ role: 'food measures', where: tableWhere(table), dataRows: table.rows.length, skippedRows: table.skippedRows });
  Object.assign(report.counts, {
    measures: measures.length,
    'foods with measures': rankInFood.size,
    'density rows': densityRows,
    'density from density rows': densityFromRows,
    'density from an mL measure': densityFromMl,
    liquids: foods.filter((f) => f.is_liquid).length,
  });
  if (keyBySurveyId) report.warnings.push(`Measures matched to foods by Survey ID (no Public Food Key column in ${basename(file)}).`);
  if (cId < 0) {
    report.warnings.push(
      'No "Measure ID" column in the measures file: measure keys use the row position within each food, so re-imports only line up if FSANZ keeps the order.',
    );
  }
  if (unknownFood) report.warnings.push(`${unknownFood} measure rows are for foods not in the nutrient profiles and were skipped.`);
  if (noGrams) report.warnings.push(`${noGrams} measures have no gram amount and were skipped.`);
  if (noLabel) report.warnings.push(`${noLabel} measures have no description and were skipped.`);
  if (duplicateIds) report.warnings.push(`${duplicateIds} measure rows repeat a measure ID for the same food; kept the first.`);

  return { foods, measures, report };
}

export async function describeAusnutHeaders(dir: string): Promise<string> {
  const located = await locateFiles(dir, AUSNUT_FILES);
  const parts: string[] = [];
  for (const spec of AUSNUT_FILES) {
    const file = located.found[spec.role];
    if (!file) {
      parts.push(`Missing: the ${spec.label}`);
      continue;
    }
    parts.push(await describeWorkbookHeaders(file, [KEY_PATTERN, SURVEY_ID_PATTERN]));
  }
  const used = new Set(Object.values(located.found));
  const others = located.all.filter((f) => !used.has(f));
  if (others.length) parts.push(`Other Excel files in ${dir} (not used): ${others.map((f) => basename(f)).join(', ')}`);
  parts.push(...located.warnings);
  return parts.join('\n\n');
}

export const ausnutAdapter: FileImportAdapter = {
  source: 'ausnut',
  label: 'AUSNUT 2023',
  async load(dir) {
    const { foods, measures } = await loadAusnut(dir);
    return { foods, measures };
  },
};
