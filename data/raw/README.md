# FSANZ data files

Put the Food Standards Australia New Zealand (FSANZ) Excel downloads in this folder. Nothing here except this README, `.gitignore` and `.gitkeep` is committed.

## What to download

Download each file yourself: FSANZ asks you to accept their licence on the download page. Keep the file names FSANZ gives them, because the importers find files by name.

**AUSNUT 2023**, from [AUSNUT data files](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/ausnut/data-files):

| File | Contents |
| --- | --- |
| Food details: `AUSNUT 2023 - Food details.xlsx` (FSANZ serves it as `AUSNUT-2023-Food-details-4.xlsx`; either name works) | Names, descriptions and keys for 3,741 foods |
| Food nutrient profiles: `AUSNUT 2023 - Food nutrient profiles.xlsx` | 58 nutrients per 100 g |
| Food measures: `AUSNUT 2023 - Food measures.xlsx` | 9,816 household measures and densities |

You can download the "All Files" ZIP and unzip it here instead; the importer looks up to three folders deep. It ignores the other AUSNUT files: recipes, dietary supplements and dietary guidelines.

**AFCD Release 3**, from [AFCD download Excel files](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd/australian-food-composition-database-download-excel-files):

| File | Contents |
| --- | --- |
| `AFCD Release 3 - Food Details.xlsx` | Names, descriptions, specific gravity for 1,588 foods |
| `AFCD Release 3 - Nutrient profiles.xlsx` | Nutrients per 100 g, plus a per-100 mL sheet for liquids |

AFCD has no household measures file.

## Licence

FSANZ's food composition data is © Food Standards Australia New Zealand. It is licensed under FSANZ's data user licence, which is based on Creative Commons Attribution-ShareAlike 3.0 Australia. Read the terms shown when you download. In practice:

- Credit FSANZ (AUSNUT 2023 and AFCD Release 3) on the About screen.
- Don't commit or re-publish these files. If we ever publish a dataset derived from them, it has to carry the same licence.

## Importing

Run each step from the project root. Run AUSNUT and AFCD separately; each one stops and changes nothing if something looks wrong.

1. **Check the headers.** This prints every sheet's detected header row. Compare the headers with the column list in `lib/sources/fsanz-common.ts` (`NUTRIENT_COLUMNS`):

   ```sh
   npm run import:ausnut -- --print-headers
   npm run import:afcd -- --print-headers
   ```

2. **Dry run.** This maps everything and writes nothing. It prints which header each of the nine nutrients came from, unit conversions (trans fat mg → g), counts, foods missing each nutrient, text values such as "<0.1" or "tr", warnings, and sample foods and measures. A required column it can't match stops the run, naming the column and listing the headers it found.

   ```sh
   npm run import:ausnut -- --dry-run
   npm run import:afcd -- --dry-run
   ```

3. **Import.** This needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) in `.env.local`.

   ```sh
   npm run import:ausnut
   npm run import:afcd
   ```

Imports are idempotent. Foods upsert on `(source, source_id)`, using the Public Food Key, and measures upsert on `(source, source_key)`. After a new FSANZ release, download the new files, remove the old ones and run the import again: rows are updated rather than duplicated. A display name someone has edited is kept. Foods and measures that were in an earlier release but not the new one are reported and left in place.

Options: `--dir <path>` reads the files from another folder, and `--batch-size <n>` changes the number of rows per request (default 500).
