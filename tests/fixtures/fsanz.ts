// Small synthetic FSANZ-style workbooks for the importer tests, written with exceljs into a temp folder.
// They copy the real files' shape (notes tab first, title rows above the header, units in the header text,
// line breaks inside headers, a per-100 mL sheet in AFCD) but the foods and numbers are made up.

import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

export type Row = (string | number | null)[];
export interface SheetSpec {
  name: string;
  rows: Row[];
  /** Merge the title cell across the header width, like FSANZ's banners. */
  mergeTitle?: boolean;
}

export async function writeWorkbook(path: string, sheets: SheetSpec[]): Promise<string> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r, i) => {
      const row = ws.getRow(i + 1);
      r.forEach((v, j) => {
        if (v !== null) row.getCell(j + 1).value = v;
      });
      row.commit();
    });
    if (s.mergeTitle) ws.mergeCells(1, 1, 1, 6);
  }
  await wb.xlsx.writeFile(path);
  return path;
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `fatty-${prefix}-`));
}

const notes = (title: string): SheetSpec => ({
  name: 'Notes',
  rows: [
    [title],
    [],
    ['Field', 'Description'],
    // A data dictionary on the notes tab mentions the key column; it mustn't be mistaken for the data.
    ['Public Food Key', 'A unique identifier for each food'],
    ['Food Name', 'The name of the food'],
  ],
});

// ---------------------------------------------------------------------------------------------
// AUSNUT 2023
// ---------------------------------------------------------------------------------------------

export const AUSNUT_PROFILE_HEADERS = [
  'Survey ID',
  'Public Food Key',
  'Food Name',
  'Energy with dietary fibre \n(kJ)',
  'Energy without dietary fibre (kJ)',
  'Moisture (water) (g)',
  'Protein (g)',
  'Total fat (g)',
  'Available carbohydrate, with sugar alcohols (g)',
  'Available carbohydrate, without sugar alcohols (g)',
  'Total sugars (g)',
  'Dietary fibre (g)',
  'Calcium (Ca) (mg)',
  'Sodium (Na) (mg)',
  // A %-of-fatty-acids column before the gram one: it must not be picked for saturated fat.
  'Total saturated fatty acids, equated (%T)',
  'Total saturated fat (g)',
  'Total trans fatty acids (mg)',
  'Vitamin C (mg)',
];

// Survey ID, key, name, energy, energy w/o fibre, moisture, protein, fat, carbs, carbs w/o SA, sugars,
// fibre, calcium, sodium, sat %T, sat g, trans mg, vit C
export const AUSNUT_PROFILE_ROWS: Row[] = [
  [19101001, 'F900001', 'Milk, cow, fluid, regular fat', 270, 270, 87.6, 3.4, 3.5, 4.7, 4.7, 4.7, 0, 115, 40, 66.2, 2.3, 120, 1],
  [16101001, 'F900002', 'Banana, cavendish, peeled, raw', 389, 368, 75.1, 1.4, 0.3, 19.6, 19.6, 15.6, 2.4, 5, 1, null, null, 'tr', 10],
  [12101001, 'F900003', 'Bread, white, commercial', 1060, 1013, 37.4, 8.4, 2.6, 46, 46, 3.2, 2.8, 120, '410', 21, 0.6, 0, null],
  [11401001, 'F900004', 'Juice, orange, commercial', 170, 168, 88.5, 0.6, 0.1, 9, 9, 8.4, 0.2, 9, 2, null, 0.02, '<0.1', 35],
  [99999001, 'F900006', 'Profile-only food, no details row', 100, 100, 90, 1, 1, 1, 1, 1, 0, 0, 5, null, 0.1, 0, null],
];

export async function writeAusnutFixtures(
  dir: string,
  opts: { profileHeaders?: string[]; profileRows?: Row[] } = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  // The name FSANZ serves the details file under.
  await writeWorkbook(join(dir, 'AUSNUT-2023-Food-details-4.xlsx'), [
    notes('AUSNUT 2023 – Food details'),
    {
      name: 'Food details',
      mergeTitle: true,
      rows: [
        ['AUSNUT 2023 – Food details'],
        ['Food Standards Australia New Zealand'],
        ['Survey ID', 'Public Food Key', 'Classification', 'Food Name', 'Food Description', 'Derivation'],
        [19101001, 'F900001', 19101, 'Milk, cow, fluid, regular fat', "Cow's milk, regular fat, unflavoured", 'Analysed'],
        [16101001, 'F900002', 16101, 'Banana, cavendish, peeled, raw', 'Cavendish banana, flesh only', 'Analysed'],
        [12101001, 'F900003', 12101, 'Bread, white, commercial', null, 'Recipe'],
        [11401001, 'F900004', 11401, 'Juice, orange, commercial', 'Orange juice, chilled', 'Label data'],
        [10101001, 'F900005', 10101, 'Details-only food, no profile', null, 'Analysed'],
        [],
        ['Note: classification codes are explained in AUSNUT 2023 – About the classifications.'],
      ],
    },
  ]);
  await writeWorkbook(join(dir, 'AUSNUT 2023 - Food nutrient profiles.xlsx'), [
    notes('AUSNUT 2023 – Food nutrient profiles'),
    {
      name: 'Food nutrient profiles',
      mergeTitle: true,
      rows: [
        ['AUSNUT 2023 – Food nutrient profiles, per 100 g edible portion'],
        [],
        opts.profileHeaders ?? AUSNUT_PROFILE_HEADERS,
        ...(opts.profileRows ?? AUSNUT_PROFILE_ROWS),
      ],
    },
  ]);
  await writeWorkbook(join(dir, 'AUSNUT 2023 - Food measures.xlsx'), [
    notes('AUSNUT 2023 – Food measures'),
    {
      name: 'Food measures',
      mergeTitle: true,
      rows: [
        ['AUSNUT 2023 – Food measures'],
        [],
        ['Public Food Key', 'Food Name', 'Measure ID', 'Quantity', 'Descriptor 1', 'Descriptor 2', 'Gram amount', 'Volume'],
        ['F900001', 'Milk, cow, fluid, regular fat', 44001, null, 'density', null, 1.03, null],
        ['F900001', 'Milk, cow, fluid, regular fat', 44002, 1, 'cup', null, 258, 250],
        ['F900001', 'Milk, cow, fluid, regular fat', 44003, 1, 'glass', 'large', 361, 350],
        ['F900002', 'Banana, cavendish, peeled, raw', 44010, null, 'density', 'piece', 0.9, null],
        ['F900002', 'Banana, cavendish, peeled, raw', 44011, null, 'density', 'sliced or chopped', 0.6, null],
        ['F900002', 'Banana, cavendish, peeled, raw', 44012, 1, 'banana', 'medium', 120, null],
        ['F900002', 'Banana, cavendish, peeled, raw', 44013, 0.5, 'banana', 'small', 45, null],
        ['F900002', 'Banana, cavendish, peeled, raw', 44014, 1, 'piece', 'bite-size', null, null],
        ['F900003', 'Bread, white, commercial', 44020, 1, 'slice', null, 36, null],
        ['F900003', 'Bread, white, commercial', 44021, 2, 'slice', 'toasted', 66, null],
        ['F900004', 'Juice, orange, commercial', 44030, 1, 'glass', '250 mL', 262, null],
        ['F999999', 'Not in the profiles', 44040, 1, 'cup', null, 100, null],
      ],
    },
  ]);
  // Decoys that a loose file pattern would pick up.
  await writeWorkbook(join(dir, 'AUSNUT 2023 - Dietary supplement nutrient profiles.xlsx'), [
    { name: 'Supplements', rows: [['Not this one']] },
  ]);
  await writeWorkbook(join(dir, 'AUSNUT 2023 - Food nutrient recipes.xlsx'), [{ name: 'Recipes', rows: [['Not this one']] }]);
  return dir;
}

// ---------------------------------------------------------------------------------------------
// AFCD Release 3
// ---------------------------------------------------------------------------------------------

export const AFCD_PROFILE_HEADERS = [
  'Public Food Key',
  'Classification',
  'Food Name',
  'Energy with dietary fibre, equated \n(kJ)',
  'Energy, without dietary fibre, equated \n(kJ)',
  'Moisture (water) \n(g)',
  'Protein \n(g)',
  'Nitrogen \n(g)',
  'Fat, total \n(g)',
  'Total dietary fibre \n(g)',
  'Total sugars (g)',
  'Available carbohydrate, with sugar alcohols \n(g)',
  'Available carbohydrate, without sugar alcohol \n(g)',
  'Sodium (Na) \n(mg)',
  'Iron (Fe) \n(mg)',
  'Vitamin A retinol equivalents \n(µg)',
  'Total saturated fatty acids, equated \n(g)',
  'Total trans fatty acids, imputed \n(mg)',
  'C18:2w6 \n(g)',
];

// key, class, name, energy, energy w/o, moisture, protein, nitrogen, fat, fibre, sugars, carbs, carbs w/o,
// sodium, iron, vit A, sat, trans mg, C18:2w6
export const AFCD_PROFILE_ROWS: Row[] = [
  ['F800001', 19101, 'Milk, cow, fluid, regular fat', 266, 266, 87.8, 3.3, 0.52, 3.4, null, 4.8, 4.8, 4.8, 39, 0.03, 50, 2.2, 110, 0.07],
  ['F800002', 11401, 'Juice, apple, commercial', 189, 186, 88, 0.1, null, 0.1, 0.1, 10.2, 10.6, 10.6, 3, 0.2, null, 0, 0, null],
  ['F800003', 22101, 'Almond, with skin, raw', 2503, 2479, 4.7, 19.5, 3.4, 54.7, 8.8, 4, 4.8, 4.8, 3, 3.9, '<LOR', 4.1, 20, 13.1],
];

export async function writeAfcdFixtures(
  dir: string,
  opts: { profileHeaders?: string[]; profileRows?: Row[]; withLiquidsSheet?: boolean } = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeWorkbook(join(dir, 'AFCD Release 3 - Food Details.xlsx'), [
    notes('Australian Food Composition Database – Release 3 – Food details'),
    {
      name: 'Food Details',
      mergeTitle: true,
      rows: [
        ['Australian Food Composition Database – Release 3'],
        ['Food details'],
        [
          'Public Food Key',
          'Classification',
          'Derivation',
          'Food Name',
          'Food Description',
          'Sampling Details',
          'Nitrogen Factor',
          'Fat Factor',
          'Specific Gravity',
        ],
        ['F800001', 19101, 'Analysed', 'Milk, cow, fluid, regular fat', 'Regular fat cow milk, about 3.4% fat', 'Sydney, 2022', 6.38, 0.945, 1.03],
        ['F800002', 11401, 'Analysed', 'Juice, apple, commercial', null, 'Canberra, 2021', 6.25, 0.8, null],
        ['F800003', 22101, 'Analysed', 'Almond, with skin, raw', 'Raw almond kernels with skin', null, 5.18, 0.956, null],
      ],
    },
  ]);
  const headers = opts.profileHeaders ?? AFCD_PROFILE_HEADERS;
  const rows = opts.profileRows ?? AFCD_PROFILE_ROWS;
  const sheets: SheetSpec[] = [
    notes('Australian Food Composition Database – Release 3 – Nutrient profiles'),
    {
      name: 'All solids & liquids per 100 g',
      mergeTitle: true,
      rows: [['Australian Food Composition Database – Release 3'], ['Nutrient profiles, per 100 g'], headers, ...rows],
    },
  ];
  if (opts.withLiquidsSheet ?? true) {
    // Per 100 mL = per 100 g × density: milk 1.03, apple juice 1.04.
    const perMl = (r: Row, d: number): Row =>
      r.map((v, i) => (i >= 3 && typeof v === 'number' ? Math.round(v * d * 100) / 100 : v));
    sheets.push({
      name: 'Liquids only per 100 mL',
      mergeTitle: true,
      rows: [
        ['Australian Food Composition Database – Release 3'],
        ['Nutrient profiles, liquids per 100 mL'],
        headers,
        perMl(rows[0], 1.03),
        perMl(rows[1], 1.04),
      ],
    });
  }
  await writeWorkbook(join(dir, 'AFCD Release 3 - Nutrient profiles.xlsx'), sheets);
  await writeWorkbook(join(dir, 'AFCD Release 3 - Nutrient details.xlsx'), [
    { name: 'Nutrient details', rows: [['Not this one'], ['Public Food Key', 'Energy (kJ)']] },
  ]);
  return dir;
}
