// npm run import:ausnut -- [--print-headers] [--dry-run] [--dir data/raw]
// Imports AUSNUT 2023 foods, nutrients and household measures. See data/raw/README.md.

import { describeAusnutHeaders, loadAusnut } from '../lib/sources/ausnut';
import { runImportCli } from './lib/cli';

runImportCli({
  source: 'ausnut',
  label: 'AUSNUT 2023',
  command: 'npm run import:ausnut',
  describeHeaders: describeAusnutHeaders,
  load: loadAusnut,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);
