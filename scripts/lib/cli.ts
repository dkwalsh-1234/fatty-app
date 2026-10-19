// Command line for the FSANZ importers:
//   --print-headers   print every sheet's detected header row and exit
//   --dry-run         map everything, print counts, column mapping and samples, write nothing
//   --dir <path>      where the downloaded files are (default data/raw)
//   --batch-size <n>  rows per upsert request (default 500)

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MissingColumnsError, type ImportReport } from '../../lib/sources/fsanz-common';
import type { FoodRow, FoodSource, MeasureRow } from '../../lib/sources/types';
import { formatReport, formatUpsertSummary } from './report';
import { BATCH_SIZE, upsertImport } from './upsert';

export interface ImportDefinition {
  source: FoodSource;
  label: string;
  /** e.g. "npm run import:ausnut" */
  command: string;
  describeHeaders(dir: string): Promise<string>;
  load(dir: string): Promise<{ foods: FoodRow[]; measures: MeasureRow[]; report: ImportReport }>;
}

function help(def: ImportDefinition): string {
  return [
    `Imports ${def.label} from the FSANZ Excel files into Supabase (foods${def.source === 'ausnut' ? ' and food_measures' : ''}).`,
    '',
    `  ${def.command} -- --print-headers   show each sheet's header row and stop`,
    `  ${def.command} -- --dry-run         map and check everything, write nothing`,
    `  ${def.command}                      import (needs .env.local with the service role key)`,
    '',
    'Options: --dir <path> (default data/raw), --batch-size <n> (default 500).',
    'See data/raw/README.md for which files to download.',
  ].join('\n');
}

export async function runImportCli(def: ImportDefinition, argv = process.argv.slice(2)): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'dry-run': { type: 'boolean', default: false },
        'print-headers': { type: 'boolean', default: false },
        dir: { type: 'string', default: 'data/raw' },
        'batch-size': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${help(def)}`);
    return 2;
  }
  if (values.help) {
    console.log(help(def));
    return 0;
  }
  const dir = resolve(values.dir!);
  const batchSize = values['batch-size'] ? Number(values['batch-size']) : BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    console.error('--batch-size must be a whole number above 0');
    return 2;
  }

  try {
    if (values['print-headers']) {
      console.log(await def.describeHeaders(dir));
      return 0;
    }

    const started = Date.now();
    const { foods, measures, report } = await def.load(dir);
    console.log(formatReport(report, foods, measures));
    if (values['dry-run']) {
      console.log('\nDry run: nothing was written.');
      return 0;
    }
    if (!foods.length) {
      console.error('\nNo foods to import.');
      return 1;
    }

    const { createAdminClient } = await import('./supabase-admin');
    const client = createAdminClient();
    console.log(`\nWriting ${foods.length} foods and ${measures.length} measures in batches of ${batchSize}…`);
    const summary = await upsertImport(client, def.source, foods, measures, { batchSize, log: (l) => console.log(l) });
    console.log(formatUpsertSummary(summary, (Date.now() - started) / 1000));
    return 0;
  } catch (e) {
    const message = (e as Error).message;
    console.error(`\n${message}`);
    if (!values['print-headers'] && (e instanceof MissingColumnsError || /^Couldn't find the .* table/.test(message))) {
      console.error(`\nTo see what the files contain: ${def.command} -- --print-headers`);
    }
    return 1;
  }
}
