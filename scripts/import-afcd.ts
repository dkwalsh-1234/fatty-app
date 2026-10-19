// npm run import:afcd -- [--print-headers] [--dry-run] [--dir data/raw]
// Imports the Australian Food Composition Database (Release 3) foods and nutrients. See data/raw/README.md.

import { describeAfcdHeaders, loadAfcd } from '../lib/sources/afcd';
import { runImportCli } from './lib/cli';

runImportCli({
  source: 'afcd',
  label: 'AFCD Release 3',
  command: 'npm run import:afcd',
  describeHeaders: describeAfcdHeaders,
  load: loadAfcd,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);
