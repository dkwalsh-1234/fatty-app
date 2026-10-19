// Plain-text output for the import scripts: what was found, how columns were mapped, counts, warnings,
// and a few sample rows, so a dry run shows whether the mapping is right before anything is written.

import { relative } from 'node:path';
import { NUTRIENTS, NUTRIENT_KEYS } from '../../lib/nutrients';
import type { ImportReport } from '../../lib/sources/fsanz-common';
import type { FoodRow, MeasureRow } from '../../lib/sources/types';
import type { UpsertSummary } from './upsert';

const n = (x: number) => x.toLocaleString('en-AU');
const rel = (p: string) => {
  const r = relative(process.cwd(), p);
  return r && !r.startsWith('..') ? r : p;
};

function fmtValue(v: number | null, unit: string): string {
  if (v === null) return '–';
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
  return `${r} ${unit}`;
}

export function formatFood(f: FoodRow): string {
  const nutrients = NUTRIENTS.map((x) => `${x.short} ${fmtValue(f[x.key], x.unit)}`).join(' · ');
  const extras = f.extra_nutrients ? Object.keys(f.extra_nutrients).length : 0;
  const bits = [
    f.is_liquid ? 'liquid' : null,
    f.density_g_per_ml ? `${f.density_g_per_ml} g/mL` : null,
    `${extras} extra nutrients`,
  ].filter(Boolean);
  const lines = [`  ${f.source_id}  ${f.name}`, `      ${nutrients}`, `      ${bits.join(', ')}`];
  if (f.common_names) {
    const c = f.common_names.length > 120 ? `${f.common_names.slice(0, 120)}…` : f.common_names;
    lines.push(`      common names: ${c}`);
  }
  return lines.join('\n');
}

export function formatReport(report: ImportReport, foods: FoodRow[], measures: MeasureRow[]): string {
  const out: string[] = [];
  out.push(`${report.label}`, '');
  out.push('Files');
  for (const [role, file] of Object.entries(report.files)) out.push(`  ${role.padEnd(9)} ${rel(file)}`);
  out.push('', 'Tables');
  for (const t of report.tables) {
    out.push(`  ${t.role}: ${t.where} — ${n(t.dataRows)} rows${t.skippedRows ? ` (${n(t.skippedRows)} non-food rows skipped)` : ''}`);
  }
  out.push('', 'Columns (per 100 g)');
  for (const m of report.mapping) out.push(`  ${m.key.padEnd(12)} ← ${m.header}${m.note ? `   [${m.note}]` : ''}`);
  const ex = report.extraColumns;
  out.push(
    `  extra_nutrients ← ${ex.length} other columns${ex.length ? `: ${ex.slice(0, 8).join('; ')}${ex.length > 8 ? '; …' : ''}` : ''}`,
  );
  out.push('', 'Counts');
  for (const [k, v] of Object.entries(report.counts)) {
    if (v === 0 && k.startsWith('density from')) continue;
    out.push(`  ${k.padEnd(34)} ${n(v)}`);
  }
  out.push('', 'Foods missing each nutrient (stored as null, never 0)');
  out.push(`  ${NUTRIENT_KEYS.map((k) => `${k} ${n(report.nullCounts[k])}`).join(' · ')}`);
  if (report.belowLor || report.unparsed.length || report.negative) {
    out.push('', 'Text in number cells');
    if (report.belowLor) out.push(`  ${n(report.belowLor)} below-limit-of-reporting cells ("<0.1", "<LOR") read as 0, as FSANZ does`);
    if (report.negative) out.push(`  ${n(report.negative)} negative numbers read as unknown (null)`);
    if (report.unparsed.length) {
      const list = report.unparsed.slice(0, 10).map((u) => `"${u.text}" × ${n(u.count)}`).join(', ');
      out.push(`  read as unknown (null): ${list}${report.unparsed.length > 10 ? ', …' : ''}`);
    }
  }
  if (report.warnings.length) {
    out.push('', 'Warnings');
    for (const w of report.warnings) out.push(`  - ${w}`);
  }

  const samples = foods.slice(0, 3);
  const liquid = foods.find((f) => f.is_liquid);
  if (liquid && !samples.includes(liquid)) samples.push(liquid);
  if (samples.length) {
    out.push('', 'Sample foods');
    for (const f of samples) out.push(formatFood(f));
  }
  if (liquid) {
    const names = foods.filter((f) => f.is_liquid).slice(0, 12).map((f) => f.name);
    out.push('', `Some foods marked as liquids: ${names.join('; ')}`);
  }
  if (measures.length) {
    out.push('', 'Sample measures');
    const nameById = new Map(foods.map((f) => [f.source_id, f.name]));
    for (const m of measures.slice(0, 8)) {
      out.push(`  ${m.source_key.padEnd(18)} ${m.label} · ${m.grams} g (rank ${m.rank})   ${nameById.get(m.food_source_id) ?? ''}`);
    }
  }
  return out.join('\n');
}

export function formatUpsertSummary(s: UpsertSummary, seconds: number): string {
  const lines = [
    '',
    `Done in ${seconds.toFixed(1)} s`,
    `  foods:    ${n(s.foods.total)} upserted (${n(s.foods.inserted)} new, ${n(s.foods.updated)} updated${
      s.foods.keptDisplayName ? `, ${n(s.foods.keptDisplayName)} kept an edited display name` : ''
    })`,
    `  measures: ${n(s.measures.total)} upserted (${n(s.measures.inserted)} new, ${n(s.measures.updated)} updated)`,
  ];
  if (s.foods.notInThisRelease) {
    lines.push(`  ${n(s.foods.notInThisRelease)} foods already in the database aren't in these files; left as they are.`);
  }
  if (s.measures.notInThisRelease) {
    lines.push(`  ${n(s.measures.notInThisRelease)} measures already in the database aren't in these files; left as they are.`);
  }
  if (s.measures.skippedNoFood) lines.push(`  ${n(s.measures.skippedNoFood)} measures skipped: their food wasn't written.`);
  return lines.join('\n');
}
