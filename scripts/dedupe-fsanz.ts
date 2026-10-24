// npm run dedupe:fsanz -- [--dry-run]
// Hides AFCD foods that AUSNUT also lists under the same name (see lib/sources/fsanz-dedupe.ts).
// Safe to run again, e.g. after re-importing AUSNUT or AFCD: it marks new duplicates and un-hides
// AFCD foods that no longer have an AUSNUT twin.

import { afcdDuplicates } from '../lib/sources/fsanz-dedupe';
import { createAdminClient } from './lib/supabase-admin';

async function all(sb: ReturnType<typeof createAdminClient>, source: string) {
  const out: { id: string; name: string; superseded_by: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('foods').select('id, name, superseded_by').eq('source', source).order('id').range(from, from + 999);
    if (error) throw new Error(`Reading ${source}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sb = createAdminClient();
  const [ausnut, afcd] = await Promise.all([all(sb, 'ausnut'), all(sb, 'afcd')]);
  const pairs = afcdDuplicates(ausnut, afcd);
  const want = new Map(pairs.map((p) => [p.afcdId, p.ausnutId]));
  const ausnutIds = new Set(ausnut.map((f) => f.id));
  const toSet = afcd.filter((f) => want.has(f.id) && f.superseded_by !== want.get(f.id));
  // Only undo what this script did (an AUSNUT twin), never a label correction.
  const toClear = afcd.filter((f) => !want.has(f.id) && f.superseded_by && ausnutIds.has(f.superseded_by));
  console.log(`${afcd.length} AFCD foods, ${pairs.length} with an AUSNUT twin: ${toSet.length} to hide, ${toClear.length} to show again.`);
  for (const f of toSet.slice(0, 5)) console.log(`  hide: ${f.name}`);
  if (dryRun) return console.log('Dry run: nothing was written.');
  const run = async (rows: typeof afcd, value: (f: (typeof afcd)[number]) => string | null) => {
    for (let i = 0; i < rows.length; i += 20) {
      await Promise.all(
        rows.slice(i, i + 20).map(async (f) => {
          const { error } = await sb.from('foods').update({ superseded_by: value(f) }).eq('id', f.id);
          if (error) throw new Error(`Updating ${f.name}: ${error.message}`);
        }),
      );
    }
  };
  await run(toSet, (f) => want.get(f.id)!);
  await run(toClear, () => null);
  console.log('Done.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
