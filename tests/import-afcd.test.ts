import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { afcdAdapter, describeAfcdHeaders, loadAfcd, type AfcdLoadResult } from '../lib/sources/afcd';
import { MissingColumnsError } from '../lib/sources/fsanz-common';
import { AFCD_PROFILE_HEADERS, AFCD_PROFILE_ROWS, tempDir, writeAfcdFixtures, writeWorkbook } from './fixtures/fsanz';

let root: string;
let dir: string;
let result: AfcdLoadResult;
const food = (key: string) => result.foods.find((f) => f.source_id === key)!;

beforeAll(async () => {
  root = await tempDir('afcd');
  dir = await writeAfcdFixtures(join(root, 'raw'));
  result = await loadAfcd(dir);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('AFCD Release 3 import', () => {
  it('finds the details and nutrient profiles files, not the nutrient details file', () => {
    expect(result.report.files.details).toMatch(/AFCD Release 3 - Food Details\.xlsx$/);
    expect(result.report.files.profiles).toMatch(/AFCD Release 3 - Nutrient profiles\.xlsx$/);
  });

  it('reads the per-100 g sheet below its title rows, and the per-100 mL sheet for liquids', () => {
    expect(result.report.tables.map((t) => [t.role, t.where])).toEqual([
      ['food details', expect.stringContaining('sheet "Food Details", header row 3')],
      ['nutrient profiles (per 100 g)', expect.stringContaining('sheet "All solids & liquids per 100 g", header row 3')],
      ['liquids (per 100 mL)', expect.stringContaining('sheet "Liquids only per 100 mL", header row 3')],
    ]);
  });

  it('maps the nine nutrients, with line breaks in headers and trans fat in mg', () => {
    expect(food('F800001')).toMatchObject({
      source: 'afcd',
      visibility: 'shared',
      created_by: null,
      name: 'Milk, cow, fluid, regular fat',
      display_name: 'Milk, cow, fluid, regular fat',
      common_names: 'Regular fat cow milk, about 3.4% fat',
      energy_kj: 266,
      protein_g: 3.3,
      fat_g: 3.4,
      sat_fat_g: 2.2,
      trans_fat_g: 0.11,
      carbs_g: 4.8,
      sugars_g: 4.8,
      fibre_g: null, // blank, not zero
      sodium_mg: 39,
    });
    expect(food('F800003').trans_fat_g).toBe(0.02);
    const mapping = Object.fromEntries(result.report.mapping.map((m) => [m.key, [m.header, m.note]]));
    expect(mapping.energy_kj).toEqual(['Energy with dietary fibre, equated (kJ)', '']);
    expect(mapping.trans_fat_g).toEqual(['Total trans fatty acids, imputed (mg)', 'mg → g (÷ 1000)']);
    expect(mapping.carbs_g[0]).toBe('Available carbohydrate, with sugar alcohols (g)');
  });

  it('keeps the other nutrients in extra_nutrients, reading "<LOR" as 0', () => {
    const almond = food('F800003').extra_nutrients!;
    expect(almond).toMatchObject({
      'Energy, without dietary fibre, equated (kJ)': 2479,
      'Nitrogen (g)': 3.4,
      'Iron (Fe) (mg)': 3.9,
      'Vitamin A retinol equivalents (µg)': 0,
      'C18:2w6 (g)': 13.1,
    });
    expect(almond).not.toHaveProperty('Classification');
    expect(food('F800002').extra_nutrients).not.toHaveProperty('Nitrogen (g)');
  });

  it('marks foods on the per-100 mL sheet as liquids, with density from specific gravity or the sheet', () => {
    expect(food('F800001')).toMatchObject({ is_liquid: true, density_g_per_ml: 1.03 }); // Specific Gravity
    expect(food('F800002')).toMatchObject({ is_liquid: true, density_g_per_ml: 1.04 }); // 91.52 mL-values ÷ 88 g
    expect(food('F800003')).toMatchObject({ is_liquid: false, density_g_per_ml: null });
    expect(result.report.counts).toMatchObject({
      liquids: 2,
      'density from specific gravity': 1,
      'density from the per-100 mL sheet': 1,
    });
  });

  it('has no measures', async () => {
    expect(result.measures).toEqual([]);
    const out = await afcdAdapter.load(dir);
    expect(out.foods).toHaveLength(3);
    expect(out.measures).toEqual([]);
  });

  it('never uses a by-difference carbohydrate: no available carbohydrate column is a hard error', async () => {
    const headers = AFCD_PROFILE_HEADERS.map((h) =>
      h.startsWith('Available carbohydrate, with ')
        ? 'Carbohydrate, by difference (g)'
        : h.startsWith('Available carbohydrate, without')
          ? 'Total carbohydrate (g)'
          : h,
    );
    const bad = await writeAfcdFixtures(join(root, 'no-carbs'), { profileHeaders: headers, profileRows: AFCD_PROFILE_ROWS });
    const err = await loadAfcd(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingColumnsError);
    expect((err as MissingColumnsError).missing).toEqual([expect.stringMatching(/^carbs_g/)]);
    expect((err as Error).message).toMatch(/Carbohydrate, by difference \(g\)/);
  });

  it('rejects a saturated fat column that is only a % of fatty acids', async () => {
    const headers = AFCD_PROFILE_HEADERS.map((h) => (h.startsWith('Total saturated') ? 'Total saturated fatty acids, equated (%T)' : h));
    const bad = await writeAfcdFixtures(join(root, 'sat-percent'), { profileHeaders: headers, profileRows: AFCD_PROFILE_ROWS });
    const err = await loadAfcd(bad).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/sat_fat_g: .*found "Total saturated fatty acids, equated \(%T\)", but its unit isn't a weight/);
  });

  it('folds a separate units row into the headers', async () => {
    const d = join(root, 'units-row');
    await writeAfcdFixtures(d, { withLiquidsSheet: false });
    const bare = AFCD_PROFILE_HEADERS.map((h) => h.replace(/\s*\((kJ|g|mg|µg)\)$/, '').replace(/\s*\n\((kJ|g|mg|µg)\)$/, ''));
    const units = AFCD_PROFILE_HEADERS.map((h) => h.match(/\((kJ|g|mg|µg)\)$/)?.[1] ?? null);
    await writeWorkbook(join(d, 'AFCD Release 3 - Nutrient profiles.xlsx'), [
      { name: 'All solids & liquids per 100 g', rows: [['Title'], [], bare, units, ...AFCD_PROFILE_ROWS] },
    ]);
    const out = await loadAfcd(d);
    expect(out.foods).toHaveLength(3);
    expect(out.foods[0].trans_fat_g).toBe(0.11);
    expect(out.report.warnings.join('\n')).toMatch(/No "Liquids only per 100 mL" sheet/);
  });

  it('prints every sheet with its detected header row', async () => {
    const text = await describeAfcdHeaders(dir);
    expect(text).toMatch(/Sheet "All solids & liquids per 100 g" .*header on row 3/);
    expect(text).toMatch(/Sheet "Liquids only per 100 mL" .*header on row 3/);
    expect(text).toMatch(/14\. Sodium \(Na\) \(mg\)/);
    expect(text).toMatch(/Other Excel files .*Nutrient details/);
  });
});
