// Australian Food Composition Database, Release 3 (FSANZ, Dec 2025): about 1,588 mostly lab-analysed foods,
// 58 core nutrients and up to 268 in all, per 100 g. Daniel downloads two files from
// https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/australian-food-composition-database-download-excel-files
// into data/raw: "AFCD Release 3 - Food Details.xlsx" and "AFCD Release 3 - Nutrient profiles.xlsx".
//
// The nutrient profiles workbook has a sheet "All solids & liquids per 100 g" (what we import) and a sheet
// "Liquids only per 100 mL". A food on the second sheet is a liquid (is_liquid). Its density is the food
// details' "Specific Gravity" when given, otherwise the ratio of its per-100 mL to per-100 g values.
// AFCD has no household measures file (Release 3 gave only a few foods a serve size, for FSANZ's own
// search site), so this adapter returns no measures.

import { basename } from 'node:path';
import {
  type FileSpec,
  type ImportReport,
  KEY_PATTERN,
  describeWorkbookHeaders,
  loadFsanzFoods,
  locateFiles,
  missingFilesMessage,
} from './fsanz-common';
import type { FileImportAdapter, FoodRow, MeasureRow } from './types';

export const AFCD_FILES: FileSpec[] = [
  {
    role: 'details',
    label: 'AFCD Release 3 food details file ("AFCD Release 3 - Food Details.xlsx")',
    include: /\bafcd\b.*\bfood details?\b/,
  },
  {
    role: 'profiles',
    label: 'AFCD Release 3 nutrient profiles file ("AFCD Release 3 - Nutrient profiles.xlsx")',
    include: /\bafcd\b.*\bnutrient profiles?\b/,
  },
];

export interface AfcdLoadResult {
  foods: FoodRow[];
  measures: MeasureRow[];
  report: ImportReport;
}

/** Reads the two AFCD files in dir. Throws with a clear message if a file or required column is missing. */
export async function loadAfcd(dir: string): Promise<AfcdLoadResult> {
  const located = await locateFiles(dir, AFCD_FILES);
  if (located.missing.length) throw new Error(missingFilesMessage(dir, located.missing, located.all));
  const { foods, report } = await loadFsanzFoods({
    source: 'afcd',
    label: 'AFCD Release 3',
    detailsFile: located.found.details,
    profilesFile: located.found.profiles,
    warnings: located.warnings,
  });
  if (!report.tables.some((t) => t.role.startsWith('liquids'))) {
    report.warnings.push('No "Liquids only per 100 mL" sheet found, so no AFCD foods are marked as liquids.');
  }
  return { foods, measures: [], report };
}

export async function describeAfcdHeaders(dir: string): Promise<string> {
  const located = await locateFiles(dir, AFCD_FILES);
  const parts: string[] = [];
  for (const spec of AFCD_FILES) {
    const file = located.found[spec.role];
    if (!file) {
      parts.push(`Missing: the ${spec.label}`);
      continue;
    }
    parts.push(await describeWorkbookHeaders(file, [KEY_PATTERN]));
  }
  const used = new Set(Object.values(located.found));
  const others = located.all.filter((f) => !used.has(f));
  if (others.length) parts.push(`Other Excel files in ${dir} (not used): ${others.map((f) => basename(f)).join(', ')}`);
  parts.push(...located.warnings);
  return parts.join('\n\n');
}

export const afcdAdapter: FileImportAdapter = {
  source: 'afcd',
  label: 'AFCD Release 3',
  async load(dir) {
    const { foods, measures } = await loadAfcd(dir);
    return { foods, measures };
  },
};
