// FSANZ Branded Food Database: packaged foods supplied by brand owners, keyed by barcode.
// https://www.foodstandards.gov.au/science-data/food-nutrient-databases/branded-food-database
// FSANZ hasn't published it yet; they say a subset will come out as a searchable site and downloadable files.
//
// When the files appear, fill in load() using the shared helpers in ./fsanz-common (locateFiles,
// tablesInWorkbook, mapNutrientColumns, parseNutrientValue) and check the headers first, as with AUSNUT:
// - source: 'fsanz_branded', source_id: FSANZ's product key (or the GTIN if that's the only key),
//   visibility: 'shared', created_by: null.
// - barcode: the GTIN, normalised the same way as everywhere else (lib/barcode.ts: a 12-digit UPC-A and its
//   13-digit EAN form with a leading zero are the same product). The migration's foods_fsanz_barcode index
//   allows one row per barcode, so de-duplicate before upserting.
// - brand, name (the product name), display_name = name.
// - The nine nutrients per 100 g from the nutrition information panel (prefer per-100 g columns over
//   per-serve; for drinks labelled per 100 mL, convert with the stated density or keep is_liquid and
//   density_g_per_ml). Missing stays null.
// - serving_g from "serving size" (grams; if it's in mL, convert with density), pack_g from the net quantity.
//   Add a 'pack' food_measures row for the serve ("1 serve · 30 g") with source_key `${source_id}#serve`.
// - Everything else on the panel goes in extra_nutrients; the original row in raw.
// The barcode lookup (BarcodeLookupAdapter in ./types) can then read these rows from `foods` by barcode.

import type { FileImportAdapter } from './types';

export const FSANZ_BRANDED_NOT_PUBLISHED = "FSANZ hasn't published the Branded Food Database files yet";

export const fsanzBrandedAdapter: FileImportAdapter = {
  source: 'fsanz_branded',
  label: 'FSANZ Branded Food Database',
  async load() {
    throw new Error(FSANZ_BRANDED_NOT_PUBLISHED);
  },
};
