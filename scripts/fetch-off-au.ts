// npm run fetch:off-au
// Streams the Open Food Facts product export (about 1.2 GB gzipped) and keeps only Australian
// products with a barcode, a name and an energy value, in data/raw/off-au.tsv.gz (a few MB).
// The full export is never written to disk. Then run `npm run import:off-au`.
//
// Data: Open Food Facts, https://world.openfoodfacts.org, Open Database Licence (ODbL).

import { createWriteStream } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { createGunzip, createGzip } from 'node:zlib';

const URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz';
const OUT = resolve('data/raw/off-au.tsv.gz');
const USER_AGENT = process.env.OFF_USER_AGENT || 'Fatty/0.1';

/** The columns kept, in this order. The import reads them by name. */
export const OFF_AU_COLUMNS = [
  'code',
  'product_name',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'product_quantity',
  'energy-kj_100g',
  'energy-kcal_100g',
  'energy_100g',
  'proteins_100g',
  'fat_100g',
  'saturated-fat_100g',
  'trans-fat_100g',
  'carbohydrates_100g',
  'sugars_100g',
  'fiber_100g',
  'sodium_100g',
  'last_modified_t',
  'data_quality_errors_tags',
] as const;

/** The export names brands in brands_en ("Oatly") or brands_tags ("oatly,xx:oatly-ab"); older ones in brands. */
function brandOf(get: (c: string) => string): string {
  const direct = get('brands') || get('brands_en');
  if (direct) return direct;
  const tag = get('brands_tags').split(',')[0]?.replace(/^[a-z]{2}:/, '') ?? '';
  return tag
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  await mkdir(resolve('data/raw'), { recursive: true });
  const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`Open Food Facts answered ${res.status}`);
  const size = Number(res.headers.get('content-length') ?? 0);
  let downloaded = 0;
  const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  body.on('data', (c: Buffer) => (downloaded += c.length));

  // Written beside the old file and renamed at the end, so a stopped run never loses the last good one.
  const out = createGzip();
  const file = createWriteStream(`${OUT}.part`);
  out.pipe(file);
  out.write(OFF_AU_COLUMNS.join('\t') + '\n');

  const lines = createInterface({ input: body.pipe(createGunzip()), crlfDelay: Infinity });
  let header: string[] | null = null;
  let idx: Record<string, number> = {};
  let countriesAt = -1;
  let total = 0;
  let australian = 0;
  let kept = 0;
  let badShape = 0;
  let branded = 0;
  const started = Date.now();

  for await (const line of lines) {
    if (!header) {
      header = line.split('\t');
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      countriesAt = idx['countries_tags'] ?? -1;
      const missing = ['code', 'product_name', 'countries_tags', 'energy_100g'].filter((c) => !(c in idx));
      if (missing.length) throw new Error(`The export is missing columns: ${missing.join(', ')}`);
      continue;
    }
    total++;
    if (total % 500_000 === 0) {
      const pct = size ? ` (${Math.round((downloaded / size) * 100)}% downloaded)` : '';
      console.log(`${total.toLocaleString()} products read, ${kept.toLocaleString()} Australian kept${pct}, ${Math.round((Date.now() - started) / 1000)} s`);
    }
    // Cheap test first: most rows aren't Australian.
    if (!line.includes('en:australia')) continue;
    const cells = line.split('\t');
    if (cells.length !== header.length) {
      badShape++;
      continue;
    }
    if (!cells[countriesAt].split(',').includes('en:australia')) continue;
    australian++;
    const get = (c: string) => (idx[c] === undefined ? '' : (cells[idx[c]] ?? '').trim());
    const hasEnergy = get('energy-kj_100g') || get('energy_100g') || get('energy-kcal_100g');
    if (!/^[0-9]{8,14}$/.test(get('code')) || !get('product_name') || !hasEnergy) continue;
    kept++;
    const brand = brandOf(get);
    if (brand) branded++;
    out.write(OFF_AU_COLUMNS.map((c) => (c === 'brands' ? brand : get(c)).replace(/[\t\r\n]+/g, ' ')).join('\t') + '\n');
  }
  out.end();
  await new Promise<void>((r) => file.on('close', () => r()));
  await rename(`${OUT}.part`, OUT);
  console.log(
    [
      `Done in ${Math.round((Date.now() - started) / 1000)} s.`,
      `${total.toLocaleString()} products in the export, ${australian.toLocaleString()} sold in Australia,`,
      `${kept.toLocaleString()} with a barcode, a name and an energy value kept in ${OUT} (${branded.toLocaleString()} with a brand).`,
      badShape ? `${badShape} malformed Australian lines skipped.` : '',
    ].join('\n'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
