import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ausnutAdapter, describeAusnutHeaders, loadAusnut, measureLabel, type AusnutLoadResult } from '../lib/sources/ausnut';
import { MissingColumnsError, parseNutrientValue, ValueStats } from '../lib/sources/fsanz-common';
import { FSANZ_BRANDED_NOT_PUBLISHED, fsanzBrandedAdapter } from '../lib/sources/fsanz-branded';
import { AUSNUT_PROFILE_HEADERS, AUSNUT_PROFILE_ROWS, tempDir, writeAusnutFixtures } from './fixtures/fsanz';

let root: string;
let dir: string;
let result: AusnutLoadResult;
const food = (key: string) => result.foods.find((f) => f.source_id === key)!;
const measuresOf = (key: string) => result.measures.filter((m) => m.food_source_id === key);

beforeAll(async () => {
  root = await tempDir('ausnut');
  dir = await writeAusnutFixtures(join(root, 'raw'));
  result = await loadAusnut(dir);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('AUSNUT 2023 import', () => {
  it('finds the files by name, skipping supplement and recipe workbooks', () => {
    expect(result.report.files.details).toMatch(/AUSNUT-2023-Food-details-4\.xlsx$/);
    expect(result.report.files.profiles).toMatch(/AUSNUT 2023 - Food nutrient profiles\.xlsx$/);
    expect(result.report.files.measures).toMatch(/AUSNUT 2023 - Food measures\.xlsx$/);
  });

  it('finds the header row under the title rows, on the data tab rather than the notes tab', () => {
    const where = result.report.tables.map((t) => t.where);
    expect(where).toEqual([
      expect.stringContaining('sheet "Food details", header row 3'),
      expect.stringContaining('sheet "Food nutrient profiles", header row 3'),
      expect.stringContaining('sheet "Food measures", header row 3'),
    ]);
    // The footnote under the food details isn't a food.
    expect(result.report.tables[0].skippedRows).toBe(1);
  });

  it('makes one shared food per nutrient profile', () => {
    expect(result.foods.map((f) => f.source_id)).toEqual(['F900001', 'F900002', 'F900003', 'F900004', 'F900006']);
    const milk = food('F900001');
    expect(milk).toMatchObject({
      source: 'ausnut',
      visibility: 'shared',
      created_by: null,
      name: 'Milk, cow, fluid, regular fat',
      display_name: 'Milk, cow, fluid, regular fat',
      common_names: "Cow's milk, regular fat, unflavoured",
    });
    // A profile with no details row still imports, named from the profile.
    expect(food('F900006').name).toBe('Profile-only food, no details row');
    expect(result.report.warnings.join('\n')).toMatch(/1 foods in the details file have no nutrient profile/);
  });

  it('maps the nine nutrients from the right columns, converting trans fat from mg to g', () => {
    const milk = food('F900001');
    expect(milk).toMatchObject({
      energy_kj: 270,
      protein_g: 3.4,
      fat_g: 3.5,
      sat_fat_g: 2.3, // the (g) column, not "(%T)"
      trans_fat_g: 0.12, // 120 mg
      carbs_g: 4.7,
      sugars_g: 4.7,
      fibre_g: 0, // a real zero stays zero
      sodium_mg: 40,
    });
    const mapping = Object.fromEntries(result.report.mapping.map((m) => [m.key, m.header]));
    expect(mapping).toMatchObject({
      energy_kj: 'Energy with dietary fibre (kJ)',
      fat_g: 'Total fat (g)',
      sat_fat_g: 'Total saturated fat (g)',
      trans_fat_g: 'Total trans fatty acids (mg)',
      carbs_g: 'Available carbohydrate, with sugar alcohols (g)',
      fibre_g: 'Dietary fibre (g)',
      sodium_mg: 'Sodium (Na) (mg)',
    });
  });

  it('keeps blank cells as null, reads numeric text, "<0.1" as 0 and "tr" as unknown', () => {
    const banana = food('F900002');
    expect(banana.sat_fat_g).toBeNull(); // blank
    expect(banana.trans_fat_g).toBeNull(); // "tr"
    expect(food('F900003').sodium_mg).toBe(410); // "410" as text
    expect(food('F900004').trans_fat_g).toBe(0); // "<0.1"
    expect(result.report.nullCounts.sat_fat_g).toBe(1);
    expect(result.report.belowLor).toBe(1);
    expect(result.report.unparsed).toEqual([{ text: 'tr', count: 1 }]);
  });

  it('puts every other nutrient column into extra_nutrients under its header, skipping blanks', () => {
    expect(food('F900001').extra_nutrients).toEqual({
      'Energy without dietary fibre (kJ)': 270,
      'Moisture (water) (g)': 87.6,
      'Available carbohydrate, without sugar alcohols (g)': 4.7,
      'Calcium (Ca) (mg)': 115,
      'Total saturated fatty acids, equated (%T)': 66.2,
      'Vitamin C (mg)': 1,
    });
    const bread = food('F900003').extra_nutrients!;
    expect(bread).not.toHaveProperty('Vitamin C (mg)');
    expect(bread).not.toHaveProperty('Survey ID');
  });

  it('keeps the source rows in raw, without empty cells', () => {
    const raw = food('F900003').raw as Record<string, Record<string, unknown>>;
    expect(raw.food_details).toEqual({
      'Survey ID': 12101001,
      'Public Food Key': 'F900003',
      Classification: 12101,
      'Food Name': 'Bread, white, commercial',
      Derivation: 'Recipe',
    });
    expect(raw.nutrient_profile['Sodium (Na) (mg)']).toBe('410');
    expect(raw.nutrient_profile).not.toHaveProperty('Vitamin C (mg)');
  });

  it('turns household measures into labelled, ranked measures with grams', () => {
    expect(measuresOf('F900001')).toEqual([
      { food_source_id: 'F900001', label: '1 cup (250 mL)', grams: 258, source: 'ausnut', source_key: 'F900001#44002', rank: 0 },
      { food_source_id: 'F900001', label: '1 glass, large (350 mL)', grams: 361, source: 'ausnut', source_key: 'F900001#44003', rank: 1 },
    ]);
    expect(measuresOf('F900002').map((m) => [m.label, m.grams, m.rank])).toEqual([
      ['1 banana, medium', 120, 0],
      ['½ banana, small', 45, 1],
    ]);
    expect(measuresOf('F900003').map((m) => [m.label, m.grams, m.rank])).toEqual([
      ['1 slice', 36, 0],
      ['2 slice, toasted', 66, 1],
    ]);
    expect(measuresOf('F999999')).toEqual([]);
    expect(result.report.counts).toMatchObject({ measures: 7, 'density rows': 3 });
    expect(result.report.warnings.join('\n')).toMatch(/1 measures have no gram amount/);
    expect(result.report.warnings.join('\n')).toMatch(/1 measure rows are for foods not in the nutrient profiles/);
  });

  it('takes density from density rows, and marks foods with mL measures as liquids', () => {
    const milk = food('F900001');
    expect(milk.density_g_per_ml).toBe(1.03);
    expect(milk.is_liquid).toBe(true);
    // Both banana densities are qualified, so the first listed wins; all are kept in raw.
    const banana = food('F900002');
    expect(banana.density_g_per_ml).toBe(0.9);
    expect(banana.is_liquid).toBe(false);
    expect((banana.raw as { densities: unknown }).densities).toEqual([
      { g_per_ml: 0.9, description: 'piece' },
      { g_per_ml: 0.6, description: 'sliced or chopped' },
    ]);
    // No density row: derived from "250 mL" weighing 262 g.
    const juice = food('F900004');
    expect(juice.density_g_per_ml).toBe(1.048);
    expect(juice.is_liquid).toBe(true);
    const bread = food('F900003');
    expect(bread.density_g_per_ml).toBeNull();
    expect(bread.is_liquid).toBe(false);
  });

  it('implements the FileImportAdapter interface', async () => {
    const out = await ausnutAdapter.load(dir);
    expect(ausnutAdapter.source).toBe('ausnut');
    expect(out.foods).toHaveLength(5);
    expect(out.measures).toHaveLength(7);
  });

  it('fails clearly when a required column is missing, naming it and listing the headers', async () => {
    const without = AUSNUT_PROFILE_HEADERS.map((h) => (h.startsWith('Sodium') ? 'Salt (g)' : h));
    const bad = await writeAusnutFixtures(join(root, 'no-sodium'), { profileHeaders: without, profileRows: AUSNUT_PROFILE_ROWS });
    const err = await loadAusnut(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingColumnsError);
    const message = (err as Error).message;
    expect(message).toMatch(/sodium_mg: "Sodium \(Na\) \(mg\)"/);
    expect(message).toMatch(/Headers found:/);
    expect(message).toMatch(/Salt \(g\)/);
    expect(message).toMatch(/Total trans fatty acids \(mg\)/);
  });

  it('names the missing file and the files it did find', async () => {
    const err = await loadAusnut(join(root, 'nowhere')).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/Folder not found/);
    const empty = await tempDir('ausnut-empty');
    const err2 = await loadAusnut(empty).catch((e: unknown) => e);
    expect((err2 as Error).message).toMatch(/Couldn't find the AUSNUT 2023 food details file/);
    await rm(empty, { recursive: true, force: true });
  });

  it('prints every sheet with its detected header row', async () => {
    const text = await describeAusnutHeaders(dir);
    expect(text).toMatch(/Sheet "Food nutrient profiles" \(\d+ rows × \d+ columns\): header on row 3, data from row 4/);
    expect(text).toMatch(/4\. Energy with dietary fibre \(kJ\)/);
    expect(text).toMatch(/Sheet "Food measures".*header on row 3/);
    expect(text).toMatch(/Other Excel files .*Dietary supplement nutrient profiles/);
  });
});

describe('measure labels', () => {
  it('combines quantity and descriptions', () => {
    expect(measureLabel(1, ['cup', 'chopped'], null)).toBe('1 cup, chopped');
    expect(measureLabel(null, ['medium'], null)).toBe('1 medium');
    expect(measureLabel(0.25, ['cup'], null)).toBe('¼ cup');
    expect(measureLabel(null, ['250 mL glass'], null)).toBe('250 mL glass');
    expect(measureLabel(1, ['can'], 375)).toBe('1 can (375 mL)');
    expect(measureLabel(null, [], null)).toBeNull();
  });
});

describe('cell values', () => {
  it('never turns missing into zero', () => {
    const stats = new ValueStats();
    expect(parseNutrientValue(null, stats)).toBeNull();
    expect(parseNutrientValue('', stats)).toBeNull();
    expect(parseNutrientValue('  ', stats)).toBeNull();
    expect(parseNutrientValue('-', stats)).toBeNull();
    expect(parseNutrientValue('n/a', stats)).toBeNull();
    expect(parseNutrientValue('trace', stats)).toBeNull();
    expect(parseNutrientValue('ND', stats)).toBeNull();
    expect(parseNutrientValue(-1, stats)).toBeNull();
    expect(parseNutrientValue(0, stats)).toBe(0);
    expect(parseNutrientValue('1,234.5', stats)).toBe(1234.5);
    expect(parseNutrientValue('<0.1', stats)).toBe(0);
    expect(parseNutrientValue('< 0.05', stats)).toBe(0);
    expect(parseNutrientValue('<LOR', stats)).toBe(0);
    expect(stats.belowLor).toBe(3);
    expect(stats.negative).toBe(1);
    expect(stats.unparsedList().map((u) => u.text)).toEqual(['trace', 'ND']);
  });
});

describe('FSANZ Branded Food Database', () => {
  it("says it hasn't been published", async () => {
    expect(fsanzBrandedAdapter.source).toBe('fsanz_branded');
    await expect(fsanzBrandedAdapter.load('data/raw')).rejects.toThrow(FSANZ_BRANDED_NOT_PUBLISHED);
  });
});
