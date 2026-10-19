// Shared pieces of the FSANZ file importers (AUSNUT 2023, AFCD Release 3): finding Daniel's downloaded
// workbooks in data/raw, finding the real header row under FSANZ's title rows, matching columns by
// header wording (with the unit read from the header), parsing cell values, and building `foods` rows
// from a food details file plus a nutrient profiles file.
//
// What we know about the real files (FSANZ docs plus other people's working importers, Oct 2026):
// - Data sits on the second tab; the first tab is notes ("More detailed information is provided on the
//   first tab of each data file"). Title rows sit above the header, which is on about row 3.
// - The key is "Public Food Key" (AFCD) / "Public food key" (AUSNUT). AUSNUT also has an 8-digit "Survey ID".
// - Headers carry their unit in brackets, sometimes after a line break: "Protein \n(g)", "Sodium (Na) (mg)".
// - AFCD's nutrient profiles workbook has two data sheets: "All solids & liquids per 100 g" and
//   "Liquids only per 100 mL". The second one tells us which foods are drinks.
// Nothing here assumes a column position or exact sheet name; run the importer with --print-headers to see
// what the files actually contain.

import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import ExcelJS from 'exceljs';
import { NUTRIENT_KEYS, type NutrientKey } from '../nutrients';
import type { FoodRow } from './types';

export type Cell = string | number | boolean | null;

/** How many rows from the top of a sheet we search for the header row. */
export const HEADER_SCAN_ROWS = 15;

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export interface FileSpec {
  role: string;
  /** What Daniel should look for on the FSANZ page. */
  label: string;
  /** Tested against the normalised file name (see normaliseFileName). */
  include: RegExp;
  exclude?: RegExp;
}

/** "AUSNUT%202023%20-%20Food%20measures.xlsx" and "AUSNUT-2023-Food-details-4.xlsx" → "ausnut 2023 food measures". */
export function normaliseFileName(name: string): string {
  let s = basename(name);
  try {
    s = decodeURIComponent(s);
  } catch {
    // Not URI-encoded; use as is.
  }
  return s
    .replace(/\.xlsx$/i, '')
    .replace(/[\s_\-–—.,()+%]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Every .xlsx under dir (a few levels deep, so an unzipped "All Files" folder works), skipping Excel lock files. */
export async function listXlsxFiles(dir: string, depth = 3): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(
      `Folder not found: ${dir}. Download the FSANZ files into data/raw/ (see data/raw/README.md) or pass --dir <path>.`,
    );
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...(await listXlsxFiles(p, depth - 1)));
    else if (e.isFile() && /\.xlsx$/i.test(e.name)) out.push(p);
  }
  return out.sort();
}

export interface LocatedFiles {
  found: Record<string, string>;
  missing: FileSpec[];
  warnings: string[];
  all: string[];
}

export async function locateFiles(dir: string, specs: FileSpec[]): Promise<LocatedFiles> {
  const all = await listXlsxFiles(dir);
  const found: Record<string, string> = {};
  const missing: FileSpec[] = [];
  const warnings: string[] = [];
  for (const spec of specs) {
    const candidates = all.filter((f) => {
      const n = normaliseFileName(f);
      return spec.include.test(n) && !(spec.exclude && spec.exclude.test(n));
    });
    if (candidates.length === 0) {
      missing.push(spec);
      continue;
    }
    let pick = candidates[0];
    if (candidates.length > 1) {
      const times = await Promise.all(candidates.map(async (f) => (await stat(f)).mtimeMs));
      pick = candidates[times.indexOf(Math.max(...times))];
      warnings.push(
        `Several files look like the ${spec.label}: ${candidates.map((c) => basename(c)).join(', ')}. Using the newest, ${basename(pick)}.`,
      );
    }
    found[spec.role] = pick;
  }
  return { found, missing, warnings, all };
}

export function missingFilesMessage(dir: string, missing: FileSpec[], all: string[]): string {
  return [
    `Couldn't find ${missing.map((m) => `the ${m.label}`).join(' or ')} in ${dir}.`,
    all.length ? `Excel files there: ${all.map((f) => basename(f)).join(', ')}` : 'There are no .xlsx files there.',
    'Keep the file names FSANZ gives them (see data/raw/README.md).',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Workbooks, sheets and header rows
// ---------------------------------------------------------------------------------------------

export async function readWorkbook(file: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(file);
  } catch (e) {
    throw new Error(`Couldn't read ${basename(file)} as an Excel workbook: ${(e as Error).message}`);
  }
  return wb;
}

/** An exceljs cell value as a plain string/number/boolean, or null for blank. Formulas give their cached result. */
export function cellToPlain(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.replace(/ /g, ' ').trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return cellToPlain(v.richText.map((r) => r.text).join(''));
    if ('error' in v) return null;
    if ('formula' in v || 'sharedFormula' in v) return cellToPlain((v.result ?? null) as ExcelJS.CellValue);
    if ('text' in v) {
      const t = (v as { text: unknown }).text;
      if (typeof t === 'string') return cellToPlain(t);
      if (t && typeof t === 'object') return cellToPlain(t as ExcelJS.CellValue);
    }
  }
  return null;
}

/** The whole sheet as rows of plain cells (0-based; row i is spreadsheet row i + 1). */
export function sheetGrid(ws: ExcelJS.Worksheet): Cell[][] {
  const grid: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values = row.values as ExcelJS.CellValue[];
    const cells: Cell[] = [];
    for (let c = 1; c < values.length; c++) cells.push(cellToPlain(values[c]));
    grid[rowNumber - 1] = cells;
  });
  for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
  return grid;
}

/** Header text with line breaks and repeated spaces collapsed ("Protein \n(g)" → "Protein (g)"). */
export function normaliseHeader(v: Cell): string {
  if (v === null) return '';
  return String(v)
    .replace(/[\s ]+/g, ' ')
    .replace(/μ/g, 'µ') // Greek mu → micro sign, so µg matches either way
    .trim();
}

function columnLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface Table {
  file: string;
  sheet: string;
  /** 1-based spreadsheet row number of the header. */
  headerRow: number;
  headers: string[];
  rows: { rowNumber: number; cells: Cell[] }[];
  /** Rows after the header that weren't food rows (blank key, footnotes). */
  skippedRows: number;
}

/**
 * The first row (0-based) near the top of the grid that has a cell matching every pattern and at least
 * three filled cells (so a "Public Food Key | A unique identifier…" line on a notes tab doesn't count), or -1.
 */
export function findHeaderRow(grid: Cell[][], patterns: RegExp[], scanRows = HEADER_SCAN_ROWS): number {
  for (let r = 0; r < Math.min(scanRows, grid.length); r++) {
    const headers = (grid[r] ?? []).map(normaliseHeader);
    if (headers.filter(Boolean).length < 3) continue;
    if (patterns.every((p) => headers.some((h) => p.test(h)))) return r;
  }
  return -1;
}

const UNIT_ONLY = /^\(?\s*(kj|kcal|g|mg|µg|ug|mcg|ng|iu|ml|%|%\s*t)\s*\)?$/i;

/**
 * Turns the header row into unique, non-empty names. If the row underneath holds only units
 * ("g", "mg", "kJ"), they're folded into the header text so unit parsing still works.
 * Returns the headers and how many extra rows were consumed.
 */
function buildHeaders(grid: Cell[][], r: number): { headers: string[]; extraRows: number } {
  const raw = (grid[r] ?? []).map(normaliseHeader);
  const below = (grid[r + 1] ?? []).map(normaliseHeader);
  const belowFilled = below.filter(Boolean);
  const unitsRow = belowFilled.length >= 3 && belowFilled.filter((u) => UNIT_ONLY.test(u)).length >= 0.8 * belowFilled.length;
  const width = Math.max(raw.length, unitsRow ? below.length : 0);
  const seen = new Map<string, number>();
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    let h = raw[i] ?? '';
    if (unitsRow && below[i] && UNIT_ONLY.test(below[i]) && !headerUnit(h)) {
      h = `${h} (${below[i].replace(/^\(|\)$/g, '')})`.trim();
    }
    if (!h) h = `Column ${columnLetter(i)}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    headers.push(n > 1 ? `${h} #${n}` : h);
  }
  return { headers, extraRows: unitsRow ? 1 : 0 };
}

/** A food key looks like "F002258" or "11101001"; anything longer or with spaces is a footnote. */
export function cleanKey(v: Cell): string | null {
  if (v === null || typeof v === 'boolean') return null;
  const s = typeof v === 'number' ? String(v) : v.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/.test(s) ? s : null;
}

export interface TableQuery {
  /** Patterns that must all match a cell in the header row. The first is the key column. */
  headerPatterns: RegExp[];
}

/** Every sheet in the workbook that has a header row matching the query, biggest first. */
export function tablesInWorkbook(wb: ExcelJS.Workbook, file: string, query: TableQuery): Table[] {
  const tables: Table[] = [];
  for (const ws of wb.worksheets) {
    const grid = sheetGrid(ws);
    const r = findHeaderRow(grid, query.headerPatterns);
    if (r < 0) continue;
    const { headers, extraRows } = buildHeaders(grid, r);
    const keyIndex = headers.findIndex((h) => query.headerPatterns[0].test(h));
    const rows: Table['rows'] = [];
    let skippedRows = 0;
    for (let i = r + 1 + extraRows; i < grid.length; i++) {
      const cells = grid[i] ?? [];
      if (cells.every((c) => c === null)) continue;
      if (cleanKey(cells[keyIndex] ?? null) === null) {
        skippedRows++;
        continue;
      }
      rows.push({ rowNumber: i + 1, cells });
    }
    tables.push({ file, sheet: ws.name, headerRow: r + 1, headers, rows, skippedRows });
  }
  return tables.sort((a, b) => b.rows.length - a.rows.length);
}

export function noTableMessage(what: string, file: string, wb: ExcelJS.Workbook, query: TableQuery): string {
  const sheets = wb.worksheets.map((ws) => {
    const grid = sheetGrid(ws).slice(0, 6);
    const preview = grid
      .map((row, i) => `      row ${i + 1}: ${row.filter((c) => c !== null).slice(0, 8).map(String).join(' | ')}`)
      .filter((l) => !/row \d+: $/.test(l));
    return [`    sheet "${ws.name}"`, ...preview].join('\n');
  });
  return [
    `Couldn't find the ${what} table in ${basename(file)}: no sheet has a row in its first ${HEADER_SCAN_ROWS} rows with columns matching ${query.headerPatterns.map(String).join(', ')}.`,
    'What the sheets start with:',
    ...sheets,
    'Run with --print-headers to see every sheet.',
  ].join('\n');
}

/** One table row as { header: value }, leaving out blank cells. */
export function rowRecord(table: Table, cells: Cell[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  table.headers.forEach((h, i) => {
    const v = cells[i];
    if (v !== null && v !== undefined) out[h] = v;
  });
  return out;
}

export function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = headers.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export function headerList(headers: string[]): string {
  return headers.map((h, i) => `  ${String(i + 1).padStart(3)}. ${h}`).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Units (read from the header text)
// ---------------------------------------------------------------------------------------------

const UNIT_TOKEN = /^(kj|kcal|g|mg|µg|ug|mcg|ng|iu|ml|%.*|[a-zµ]+\s*\/\s*[a-z0-9 ]+)$/i;

/** The unit in the header's last brackets: "Sodium (Na) (mg)" → "mg"; "Moisture (water)" → null. */
export function headerUnit(header: string): string | null {
  const m = header.match(/\(([^()]*)\)\s*$/);
  if (!m) return null;
  const u = m[1].trim().replace(/\s*(?:\/|per)\s*100\s*(?:g|ml)$/i, '');
  return UNIT_TOKEN.test(u) ? u : null;
}

/** Mass units in micrograms, so conversions are exact-ish integer ratios (120 mg → 0.12 g). */
const MICROGRAMS: Record<string, number> = { g: 1e6, mg: 1e3, µg: 1, ug: 1, mcg: 1, ng: 1e-3 };
const KILOJOULES: Record<string, number> = { kj: 1, kcal: 4.184 };

export type TargetUnit = 'kJ' | 'g' | 'mg';

/** Multiply-then-divide pair that converts `unit` to `target`, or null if they aren't the same kind. */
export function unitConversion(unit: string, target: TargetUnit): { mul: number; div: number } | null {
  const u = unit.toLowerCase();
  if (target === 'kJ') return u in KILOJOULES ? { mul: KILOJOULES[u], div: 1 } : null;
  const from = MICROGRAMS[u] ?? MICROGRAMS[unit];
  const to = MICROGRAMS[target];
  return from === undefined ? null : { mul: from, div: to };
}

// ---------------------------------------------------------------------------------------------
// The nine nutrients
// ---------------------------------------------------------------------------------------------

export interface NutrientColumnSpec {
  key: NutrientKey;
  /** What we looked for, for error messages. */
  describe: string;
  /** In priority order: the first pattern that matches a header with a usable unit wins. */
  patterns: RegExp[];
  /** Headers that must never be used for this nutrient. */
  never?: RegExp;
  unit: TargetUnit;
}

// FSANZ header wording: AFCD Release 3 uses "Energy with dietary fibre, equated (kJ)", "Protein (g)",
// "Fat, total (g)", "Total saturated fatty acids, equated (g)", "Total trans fatty acids, imputed (mg)",
// "Available carbohydrate, with sugar alcohols (g)", "Total sugars (g)", "Total dietary fibre (g)",
// "Sodium (Na) (mg)". AUSNUT 2023 uses the AUSNUT 2011-13 style: "Energy with dietary fibre (kJ)",
// "Total fat (g)", "Dietary fibre (g)", and so on. The patterns accept both and small rewordings.
export const NUTRIENT_COLUMNS: NutrientColumnSpec[] = [
  {
    key: 'energy_kj',
    describe: 'Energy with dietary fibre (kJ)',
    // Australian energy includes fibre's contribution; the "without dietary fibre" column goes to extras.
    patterns: [/^energy,? (with|including) (dietary )?fibre\b/i, /^energy\b(?!.*\b(without|excluding)\b)/i],
    unit: 'kJ',
  },
  {
    key: 'protein_g',
    describe: 'Protein (g)',
    patterns: [/^protein\b/i],
    unit: 'g',
  },
  {
    key: 'fat_g',
    describe: 'Fat, total (g) / Total fat (g)',
    patterns: [/^fat,? total\b/i, /^total fat\b(?!ty)/i, /^fat\b(?!ty)(?!.*\bacids?\b)/i],
    unit: 'g',
  },
  {
    key: 'sat_fat_g',
    describe: 'Total saturated fatty acids (g)',
    patterns: [/^total saturated fatty acids?\b/i, /^(total )?saturated fat(s|ty acids?)?\b/i, /^fat,? saturated\b/i],
    unit: 'g',
  },
  {
    key: 'trans_fat_g',
    describe: 'Total trans fatty acids (g or mg)',
    patterns: [/^total trans fatty acids?\b/i, /^(total )?trans fat(s|ty acids?)?\b/i, /^fat,? trans\b/i],
    unit: 'g',
  },
  {
    key: 'carbs_g',
    describe: 'Available carbohydrate, with sugar alcohols (g)',
    // Australian "available carbohydrate" excludes fibre. Never a by-difference or US-style total.
    patterns: [
      /^available carbohydrates?,? with sugar alcohols?\b/i,
      /^available carbohydrates?,? without sugar alcohols?\b/i,
      /^available carbohydrates?\b/i,
    ],
    never: /by difference|^total carbohydrate|^carbohydrate,? total/i,
    unit: 'g',
  },
  {
    key: 'sugars_g',
    describe: 'Total sugars (g)',
    patterns: [/^total sugars?\b/i, /^sugars?,? total\b/i],
    unit: 'g',
  },
  {
    key: 'fibre_g',
    describe: 'Total dietary fibre (g) / Dietary fibre (g)',
    patterns: [/^total dietary fib(re|er)\b/i, /^dietary fib(re|er)\b/i, /^fib(re|er),? total dietary\b/i],
    unit: 'g',
  },
  {
    key: 'sodium_mg',
    describe: 'Sodium (Na) (mg)',
    patterns: [/^sodium\b/i],
    unit: 'mg',
  },
];

export interface NutrientColumn {
  key: NutrientKey;
  index: number;
  header: string;
  unit: string;
  mul: number;
  div: number;
}

export interface NutrientMapping {
  columns: Record<NutrientKey, NutrientColumn>;
  /** Every other column with a unit in its header: kept in extra_nutrients under its header text. */
  extras: { index: number; header: string }[];
}

export class MissingColumnsError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
    readonly headers: string[],
  ) {
    super(message);
    this.name = 'MissingColumnsError';
  }
}

export function tableWhere(t: Table): string {
  return `${basename(t.file)}, sheet "${t.sheet}", header row ${t.headerRow}`;
}

export function mapNutrientColumns(table: Table, what: string): NutrientMapping {
  const columns = {} as Record<NutrientKey, NutrientColumn>;
  const problems: string[] = [];
  for (const spec of NUTRIENT_COLUMNS) {
    let chosen: NutrientColumn | null = null;
    const wrongUnit: string[] = [];
    for (const p of spec.patterns) {
      const matches = table.headers
        .map((header, index) => ({ header, index }))
        .filter(({ header }) => p.test(header) && !(spec.never && spec.never.test(header)));
      // Prefer the column already in the target unit (kJ over kcal), then any convertible one.
      const ranked = [...matches].sort((a, b) => {
        const ua = headerUnit(a.header)?.toLowerCase() === spec.unit.toLowerCase() ? 0 : 1;
        const ub = headerUnit(b.header)?.toLowerCase() === spec.unit.toLowerCase() ? 0 : 1;
        return ua - ub;
      });
      for (const m of ranked) {
        const unit = headerUnit(m.header);
        const conv = unit ? unitConversion(unit, spec.unit) : null;
        if (unit && conv) {
          chosen = { key: spec.key, index: m.index, header: m.header, unit, ...conv };
          break;
        }
        if (!wrongUnit.includes(m.header)) wrongUnit.push(m.header);
      }
      if (chosen) break;
    }
    if (chosen) columns[spec.key] = chosen;
    else {
      const note = wrongUnit.length
        ? ` (found ${wrongUnit.map((h) => `"${h}"`).join(', ')}, but its unit isn't ${spec.unit === 'kJ' ? 'kJ' : 'a weight like g or mg'})`
        : '';
      problems.push(`${spec.key}: "${spec.describe}"${note}`);
    }
  }
  if (problems.length) {
    throw new MissingColumnsError(
      [
        `${what}: couldn't find ${problems.length === 1 ? 'a required column' : 'required columns'} in ${tableWhere(table)}:`,
        ...problems.map((p) => `  - ${p}`),
        'Headers found:',
        headerList(table.headers),
      ].join('\n'),
      problems,
      table.headers,
    );
  }
  const used = new Set(Object.values(columns).map((c) => c.index));
  const extras = table.headers
    .map((header, index) => ({ header, index }))
    .filter(({ header, index }) => !used.has(index) && headerUnit(header) !== null);
  return { columns, extras };
}

// ---------------------------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------------------------

/** Counts of the cell values that weren't plain numbers, for the dry-run report. */
export class ValueStats {
  belowLor = 0;
  negative = 0;
  unparsed = new Map<string, number>();

  noteUnparsed(text: string) {
    this.unparsed.set(text, (this.unparsed.get(text) ?? 0) + 1);
  }

  unparsedList(): { text: string; count: number }[] {
    return [...this.unparsed.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count);
  }
}

const NUMBER_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;
const MISSING_MARKERS = /^(-+|–|—|n\/?a|na|null|none|\.|\*)$/i;

/**
 * A nutrient cell as a number, or null when it's unknown. Missing is not zero: blank → null.
 *
 * Text values:
 * - "<0.1", "< 0.05", "<LOR", "LOR", "BLOR" (below the limit of reporting) → 0. This follows FSANZ's own
 *   rule: "Analytical results reported to be less than the limit of reporting (<LOR) by the laboratory
 *   are reported as zero" (About the Australian Food Composition Database – Release 3, Dec 2025). The
 *   published files already apply it, so these shouldn't appear; if one does, we treat it the same way.
 * - "tr" / "trace" / "ND" and any other text → null (unknown), counted and shown in the dry-run. FSANZ's
 *   docs don't define a trace value, so we don't guess one.
 * - "-", "n/a" and similar → null.
 * - Negative numbers → null (counted): a nutrient can't be negative and the database rejects it.
 */
export function parseNutrientValue(v: Cell, stats?: ValueStats): number | null {
  if (v === null) return null;
  if (typeof v === 'boolean') {
    stats?.noteUnparsed(String(v));
    return null;
  }
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const s = v.trim();
    if (s === '' || MISSING_MARKERS.test(s)) return null;
    const plain = s.replace(/,(?=\d{3}(\D|$))/g, '');
    if (NUMBER_RE.test(plain)) n = Number(plain);
    else if (/^<\s*(\d+(\.\d*)?|\.\d+|lor|lod|loq)$/i.test(s) || /^b?lor$/i.test(s)) {
      if (stats) stats.belowLor++;
      return 0;
    } else {
      stats?.noteUnparsed(s);
      return null;
    }
  }
  if (!Number.isFinite(n)) return null;
  if (n < 0) {
    if (stats) stats.negative++;
    return null;
  }
  return n;
}

export function convert(value: number, c: { mul: number; div: number }): number {
  if (c.mul === c.div) return value;
  return (value * c.mul) / c.div;
}

/** A plain positive number from a non-nutrient cell (grams, density, specific gravity). */
export function positiveNumber(v: Cell): number | null {
  const n = parseNutrientValue(v);
  return n !== null && n > 0 ? n : null;
}

export const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

// ---------------------------------------------------------------------------------------------
// Foods from food details + nutrient profiles
// ---------------------------------------------------------------------------------------------

export const KEY_PATTERN = /^public ?food ?key\b|^pfk$/i;
export const NAME_PATTERN = /^food ?name$/i;
const DESCRIPTION_PATTERN = /^food ?description$/i;
const SYNONYM_PATTERN = /^(synonyms?|common names?|also known as|alternative names?|other names?)$/i;
const SPECIFIC_GRAVITY_PATTERN = /^specific ?gravity\b|^density\b/i;
export const SURVEY_ID_PATTERN = /^survey ?id$/i;
/** A per-100 mL sheet ("Liquids only per 100 mL"). Note the per-100 g sheet's name also says "liquids". */
const PER_100ML_SHEET = /100\s*m\s*l\b|\bper\s*100\s*ml/i;

export interface ImportReport {
  label: string;
  files: Record<string, string>;
  tables: { role: string; where: string; dataRows: number; skippedRows: number }[];
  mapping: { key: NutrientKey; header: string; unit: string; note: string }[];
  extraColumns: string[];
  counts: Record<string, number>;
  /** How many foods have each nutrient missing (null). */
  nullCounts: Record<NutrientKey, number>;
  belowLor: number;
  negative: number;
  unparsed: { text: string; count: number }[];
  warnings: string[];
}

export interface FoodsLoadResult {
  foods: FoodRow[];
  report: ImportReport;
  /** source_id → food row, for adapters that add measures and densities. */
  byKey: Map<string, FoodRow>;
  details: Table;
  /** Survey ID → Public Food Key, when the details file has both. */
  surveyIdToKey: Map<string, string>;
}

export interface FoodsLoadOptions {
  source: 'ausnut' | 'afcd';
  label: string;
  detailsFile: string;
  profilesFile: string;
  warnings?: string[];
}

function pickProfileTables(tables: Table[]): { per100g: Table | null; per100ml: Table | null } {
  const ml = tables.filter((t) => PER_100ML_SHEET.test(t.sheet));
  const g = tables.filter((t) => !PER_100ML_SHEET.test(t.sheet));
  const per100g = g.find((t) => /100\s*g\b/i.test(t.sheet)) ?? g[0] ?? null;
  return { per100g, per100ml: ml[0] ?? null };
}

function conversionNote(c: NutrientColumn, target: TargetUnit): string {
  if (c.mul === c.div) return '';
  return c.mul < c.div ? `${c.unit} → ${target} (÷ ${c.div / c.mul})` : `${c.unit} → ${target} (× ${c.mul / c.div})`;
}

/**
 * Reads a details workbook and a nutrient profiles workbook and builds one `foods` row per profile row.
 * Throws a clear error if a sheet or required column can't be found.
 */
export async function loadFsanzFoods(opts: FoodsLoadOptions): Promise<FoodsLoadResult> {
  const warnings = [...(opts.warnings ?? [])];
  const stats = new ValueStats();

  // Food details: key + name.
  const detailsWb = await readWorkbook(opts.detailsFile);
  const detailsQuery = { headerPatterns: [KEY_PATTERN, NAME_PATTERN] };
  const details = tablesInWorkbook(detailsWb, opts.detailsFile, detailsQuery)[0];
  if (!details) throw new Error(noTableMessage(`${opts.label} food details`, opts.detailsFile, detailsWb, detailsQuery));

  // Nutrient profiles: key + an energy column. Possibly a second sheet per 100 mL.
  const profilesWb = await readWorkbook(opts.profilesFile);
  const profilesQuery = { headerPatterns: [KEY_PATTERN, /^energy\b/i] };
  const { per100g, per100ml } = pickProfileTables(tablesInWorkbook(profilesWb, opts.profilesFile, profilesQuery));
  if (!per100g) throw new Error(noTableMessage(`${opts.label} nutrient profiles`, opts.profilesFile, profilesWb, profilesQuery));

  const mapping = mapNutrientColumns(per100g, `${opts.label} nutrient profiles`);

  const dKey = findColumn(details.headers, [KEY_PATTERN]);
  const dName = findColumn(details.headers, [NAME_PATTERN]);
  const dDesc = findColumn(details.headers, [DESCRIPTION_PATTERN]);
  const dSyn = details.headers.map((h, i) => (SYNONYM_PATTERN.test(h) ? i : -1)).filter((i) => i >= 0);
  const dSg = findColumn(details.headers, [SPECIFIC_GRAVITY_PATTERN]);
  const dSurvey = findColumn(details.headers, [SURVEY_ID_PATTERN]);
  const pKey = findColumn(per100g.headers, [KEY_PATTERN]);
  const pName = findColumn(per100g.headers, [NAME_PATTERN]);

  const detailsByKey = new Map<string, Table['rows'][number]>();
  const surveyIdToKey = new Map<string, string>();
  let duplicateDetails = 0;
  for (const row of details.rows) {
    const key = cleanKey(row.cells[dKey] ?? null)!;
    if (detailsByKey.has(key)) {
      duplicateDetails++;
      continue;
    }
    detailsByKey.set(key, row);
    if (dSurvey >= 0) {
      const sid = cleanKey(row.cells[dSurvey] ?? null);
      if (sid) surveyIdToKey.set(sid, key);
    }
  }

  // Liquids: rows of the per-100 mL sheet, keyed, for is_liquid and a density fallback.
  const liquidsByKey = new Map<string, Cell[]>();
  if (per100ml) {
    const lKey = findColumn(per100ml.headers, [KEY_PATTERN]);
    for (const row of per100ml.rows) liquidsByKey.set(cleanKey(row.cells[lKey] ?? null)!, row.cells);
  }

  const foods: FoodRow[] = [];
  const byKey = new Map<string, FoodRow>();
  const nullCounts = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;
  let duplicateProfiles = 0;
  let noName = 0;
  let profilesWithoutDetails = 0;
  let densityFromSg = 0;
  let densityFromMlSheet = 0;

  for (const row of per100g.rows) {
    const key = cleanKey(row.cells[pKey] ?? null)!;
    if (byKey.has(key)) {
      duplicateProfiles++;
      continue;
    }
    const det = detailsByKey.get(key);
    if (!det) profilesWithoutDetails++;
    const nameCell = (det && dName >= 0 ? det.cells[dName] : null) ?? (pName >= 0 ? row.cells[pName] : null) ?? null;
    const name = nameCell === null ? '' : normaliseHeader(nameCell);
    if (!name) {
      noName++;
      continue;
    }

    const nutrients = {} as Record<NutrientKey, number | null>;
    for (const k of NUTRIENT_KEYS) {
      const c = mapping.columns[k];
      const v = parseNutrientValue(row.cells[c.index] ?? null, stats);
      nutrients[k] = v === null ? null : convert(v, c);
      if (nutrients[k] === null) nullCounts[k]++;
    }

    const extras: Record<string, number> = {};
    for (const x of mapping.extras) {
      const v = parseNutrientValue(row.cells[x.index] ?? null, stats);
      if (v !== null) extras[x.header] = v;
    }

    const names: string[] = [];
    if (det) {
      for (const i of [dDesc, ...dSyn]) {
        const v = i >= 0 ? det.cells[i] : null;
        if (v !== null && v !== undefined) {
          const t = normaliseHeader(v);
          if (t && t !== name && !names.includes(t)) names.push(t);
        }
      }
    }

    const liquidCells = liquidsByKey.get(key);
    let density: number | null = null;
    const sg = det && dSg >= 0 ? positiveNumber(det.cells[dSg] ?? null) : null;
    if (sg !== null && sg > 0.2 && sg < 5) {
      density = sg;
      densityFromSg++;
    } else if (liquidCells && per100ml) {
      density = densityFromLiquidSheet(per100g, per100ml, row.cells, liquidCells, mapping);
      if (density !== null) densityFromMlSheet++;
    }

    const food: FoodRow = {
      source: opts.source,
      source_id: key,
      visibility: 'shared',
      created_by: null,
      name,
      display_name: name,
      common_names: names.length ? names.join('; ') : null,
      ...nutrients,
      extra_nutrients: Object.keys(extras).length ? extras : null,
      is_liquid: liquidCells !== undefined,
      density_g_per_ml: density,
      raw: {
        food_details: det ? rowRecord(details, det.cells) : null,
        nutrient_profile: rowRecord(per100g, row.cells),
      },
    };
    foods.push(food);
    byKey.set(key, food);
  }

  const detailsWithoutProfiles = [...detailsByKey.keys()].filter((k) => !byKey.has(k)).length;
  if (duplicateProfiles) warnings.push(`${duplicateProfiles} nutrient profile rows repeat a Public Food Key; kept the first of each.`);
  if (duplicateDetails) warnings.push(`${duplicateDetails} food details rows repeat a Public Food Key; kept the first of each.`);
  if (profilesWithoutDetails) warnings.push(`${profilesWithoutDetails} nutrient profiles have no food details row (name taken from the profile).`);
  if (detailsWithoutProfiles) warnings.push(`${detailsWithoutProfiles} foods in the details file have no nutrient profile and were skipped.`);
  if (noName) warnings.push(`${noName} profile rows have no food name and were skipped.`);
  if (per100ml && liquidsByKey.size === 0) warnings.push(`Sheet "${per100ml.sheet}" has no food rows, so no foods are marked as liquids from it.`);

  const tables: ImportReport['tables'] = [
    { role: 'food details', where: tableWhere(details), dataRows: details.rows.length, skippedRows: details.skippedRows },
    { role: 'nutrient profiles (per 100 g)', where: tableWhere(per100g), dataRows: per100g.rows.length, skippedRows: per100g.skippedRows },
  ];
  if (per100ml) {
    tables.push({ role: 'liquids (per 100 mL)', where: tableWhere(per100ml), dataRows: per100ml.rows.length, skippedRows: per100ml.skippedRows });
  }

  const report: ImportReport = {
    label: opts.label,
    files: { details: opts.detailsFile, profiles: opts.profilesFile },
    tables,
    mapping: NUTRIENT_COLUMNS.map((s) => {
      const c = mapping.columns[s.key];
      return { key: s.key, header: c.header, unit: c.unit, note: conversionNote(c, s.unit) };
    }),
    extraColumns: mapping.extras.map((x) => x.header),
    counts: {
      foods: foods.length,
      'food details rows': details.rows.length,
      'nutrient profile rows': per100g.rows.length,
      liquids: foods.filter((f) => f.is_liquid).length,
      'density from specific gravity': densityFromSg,
      'density from the per-100 mL sheet': densityFromMlSheet,
      'foods with extra nutrients': foods.filter((f) => f.extra_nutrients).length,
    },
    nullCounts,
    belowLor: stats.belowLor,
    negative: stats.negative,
    unparsed: stats.unparsedList(),
    warnings,
  };
  return { foods, report, byKey, details, surveyIdToKey };
}

/**
 * Per-100 mL values are the per-100 g values times the density, so their ratio is the density. We use the
 * column with the biggest per-100 g value (energy in kJ, or moisture) to keep rounding error small.
 */
function densityFromLiquidSheet(
  per100g: Table,
  per100ml: Table,
  gCells: Cell[],
  mlCells: Cell[],
  mapping: NutrientMapping,
): number | null {
  const mlIndex = new Map(per100ml.headers.map((h, i) => [h, i]));
  const candidates = [...Object.values(mapping.columns).map((c) => c.index), ...mapping.extras.map((x) => x.index)];
  let best: { g: number; ml: number } | null = null;
  for (const i of candidates) {
    const header = per100g.headers[i];
    if (!/\((g|mg|kj)\)$/i.test(header)) continue;
    const j = mlIndex.get(header);
    if (j === undefined) continue;
    const g = parseNutrientValue(gCells[i] ?? null);
    const ml = parseNutrientValue(mlCells[j] ?? null);
    if (g === null || ml === null || g <= 0 || ml <= 0) continue;
    if (!best || g > best.g) best = { g, ml };
  }
  if (!best) return null;
  const d = round(best.ml / best.g, 3);
  return d > 0.3 && d < 3 ? d : null;
}

// ---------------------------------------------------------------------------------------------
// --print-headers
// ---------------------------------------------------------------------------------------------

/** Every sheet's detected header row, for Daniel to check against the column patterns. */
export async function describeWorkbookHeaders(file: string, keyPatterns: RegExp[] = [KEY_PATTERN]): Promise<string> {
  const wb = await readWorkbook(file);
  const out: string[] = [`${basename(file)}`];
  for (const ws of wb.worksheets) {
    const grid = sheetGrid(ws);
    let r = -1;
    for (const p of keyPatterns) {
      r = findHeaderRow(grid, [p]);
      if (r >= 0) break;
    }
    const width = Math.max(0, ...grid.map((row) => row.length));
    if (r < 0) {
      const first = grid.findIndex((row) => row.some((c) => c !== null));
      const preview = first >= 0 ? grid[first].filter((c) => c !== null).slice(0, 6).map(String).join(' | ') : '(empty)';
      out.push(
        `  Sheet "${ws.name}" (${grid.length} rows × ${width} columns): no row with a key column in the first ${HEADER_SCAN_ROWS} rows.`,
        `    First text: ${preview.length > 160 ? `${preview.slice(0, 160)}…` : preview}`,
      );
      continue;
    }
    const { headers, extraRows } = buildHeaders(grid, r);
    out.push(
      `  Sheet "${ws.name}" (${grid.length} rows × ${width} columns): header on row ${r + 1}${extraRows ? ` (units on row ${r + 2})` : ''}, data from row ${r + 2 + extraRows}`,
      headerList(headers),
    );
  }
  return out.join('\n');
}
