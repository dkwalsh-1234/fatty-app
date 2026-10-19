// npm run import:off-au -- [--dry-run] [--dir data/raw]
// Imports the Australian Open Food Facts products that `npm run fetch:off-au` kept, as shared
// foods (source 'off'), so branded products like "Oatly Barista" are found by name. Re-running
// updates rows rather than duplicating them. Data: Open Food Facts, Open Database Licence (ODbL).

import { loadOffAu, OFF_AU_FILE } from '../lib/sources/off-au';
import { runImportCli } from './lib/cli';

/** Barcodes already in the shared label catalogue keep their label row (one row per barcode). */
async function labelBarcodes(): Promise<Set<string>> {
  const { createAdminClient, loadEnv } = await import('./lib/supabase-admin');
  loadEnv();
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return new Set();
  const { data, error } = await createAdminClient().from('foods').select('barcode').eq('source', 'label').not('barcode', 'is', null);
  if (error) throw new Error(`Couldn't read the label catalogue: ${error.message}`);
  return new Set((data ?? []).map((r) => r.barcode as string));
}

runImportCli({
  source: 'off',
  label: 'Open Food Facts, Australian products',
  command: 'npm run import:off-au',
  describeHeaders: async (dir) => `${dir}/${OFF_AU_FILE}: the columns written by scripts/fetch-off-au.ts`,
  load: async (dir) => loadOffAu(dir, await labelBarcodes()),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);
