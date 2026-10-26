'use client';

// The Today screen, as designed (01-today, 02-today-over). Presentational: the page wires data in.

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { EnergyRing, MacroLegend } from '@/design/components/EnergyRing';
import { TargetBar } from '@/design/components/TargetBar';
import { tokens } from '@/design/tokens/tokens';
import { MEAL_LABEL, shortDate } from '@/lib/dates';
import { captionParts } from '@/lib/caption';
import { entryEnergyKj, isAiEstimate, type DayView } from '@/lib/day';
import type { ActivityLevel } from '@/lib/target';
import { amountText, energyIn, grams, int, kg, one, saltText, unitCaps, unitLabel } from '@/lib/format';
import { NUTRIENT_BY_KEY, type NutrientKey } from '@/lib/nutrients';
import type { EnergyUnit, LogEntry } from '@/lib/types';
import { PRECISION_NOTE, TargetBreakdownCard } from '../app/TargetBreakdown';
import { DashedChip, Icon, MacroDot, MoreDots, Sheet } from '../ui';
import { BreakdownSheet } from './BreakdownSheet';

const P = tokens.color.pine;

export interface TodayHandlers {
  onWeigh: () => void;
  onMenu: () => void;
  onEntry: (e: LogEntry) => void;
  onGroupMenu: (meal: DayView['groups'][number]) => void;
  logHref: (route: 'scan' | 'photo' | 'search' | 'type') => string;
}

export function TodayView({ day, title, capsDate, weightKg, unit, activityLevel, missingKeys, handlers, notice }: {
  day: DayView;
  title: string;
  capsDate: string;
  weightKg: number | null;
  unit: EnergyUnit;
  activityLevel: ActivityLevel | null;
  /** Nutrients whose gaps get a chip on log rows: energy plus any with a target. */
  missingKeys: NutrientKey[];
  handlers: TodayHandlers;
  notice?: ReactNode;
}) {
  // Tap a number to see which of today's foods made it up.
  const [breakdownOf, setBreakdownOf] = useState<NutrientKey | null>(null);
  return (
    <div className="mx-auto w-full max-w-[480px] pb-dock">
      <Hero
        day={day}
        title={title}
        capsDate={capsDate}
        weightKg={weightKg}
        unit={unit}
        activityLevel={activityLevel}
        onWeigh={handlers.onWeigh}
        onMenu={handlers.onMenu}
        onBreakdown={setBreakdownOf}
      />
      <div className="flex flex-col gap-2.5 px-4 pt-4">
        {notice}
        <TargetsCard day={day} unit={unit} onBreakdown={setBreakdownOf} />
        <MoreNutrients day={day} onBreakdown={setBreakdownOf} />
        <h2 className="caps mx-1 mb-0 mt-3 text-ink2">Log</h2>
        {day.groups.map((g) => (
          <LogGroup key={g.meal} group={g} unit={unit} missingKeys={missingKeys} onEntry={handlers.onEntry} onMenu={() => handlers.onGroupMenu(g)} />
        ))}
      </div>
      <LogDock href={handlers.logHref} />
      {breakdownOf && (
        <BreakdownSheet
          day={day}
          unit={unit}
          nutrient={breakdownOf}
          onNutrient={setBreakdownOf}
          onClose={() => setBreakdownOf(null)}
          onEntry={(e) => {
            setBreakdownOf(null);
            handlers.onEntry(e);
          }}
        />
      )}
    </div>
  );
}

function Hero({ day, title, capsDate, weightKg, unit, activityLevel, onWeigh, onMenu, onBreakdown }: {
  day: DayView;
  title: string;
  capsDate: string;
  weightKg: number | null;
  unit: EnergyUnit;
  activityLevel: ActivityLevel | null;
  onWeigh: () => void;
  onMenu: () => void;
  onBreakdown: (k: NutrientKey) => void;
}) {
  const [grams, setGrams] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const ring = day.ring;
  return (
    <section className="min-h-[488px] rounded-b-band bg-band pb-6 text-pine-mint">
      <header className="flex h-[76px] items-start justify-between pl-5 pr-4 pt-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold tracking-[0.05em] text-pine-mint2">{capsDate}</span>
          <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.025em]">{title}</h1>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onMenu}
            aria-label="Menu: meals, goal, trends, settings"
            className="press flex h-[38px] w-[38px] items-center justify-center rounded-full border-0 bg-pine-raised text-pine-mint"
          >
            <Icon name="menu" size={18} stroke={1.9} />
          </button>
          <button
            type="button"
            onClick={onWeigh}
            aria-label={weightKg ? `Weigh-in: ${kg(weightKg)} kg. Tap to log a new weight` : 'Log your weight'}
            className="press flex h-[38px] items-center gap-[7px] rounded-[19px] border-0 bg-pine-raised pl-[11px] pr-3.5 text-sm font-medium text-pine-mint"
          >
            <Icon name="scale" size={18} stroke={1.9} />
            <span className="tnum">{weightKg ? `${kg(weightKg)} kg` : 'Weigh in'}</span>
          </button>
        </div>
      </header>

      <div className="mt-2 flex justify-center">
        {ring ? (
          <div className="cc-ring-in">
            <EnergyRing
              target={ring.target}
              base={ring.base}
              eaten={day.eaten}
              activity={ring.activity}
              goal={day.goal ? { progress: day.goal.progress, pace: day.goal.pace } : null}
              unit={unitCaps(unit)}
              onToggle={() => setGrams((g) => !g)}
            >
              {grams ? <GramsCentre day={day} /> : undefined}
            </EnergyRing>
          </div>
        ) : (
          <div className="flex h-[280px] w-[280px] flex-col items-center justify-center gap-2 rounded-full border-[26px] border-pine-track text-center">
            <span className="px-4 text-[15px] text-pine-mint2">Add your profile to see a daily target.</span>
            <Link href="/goal" className="text-[15px] font-semibold text-pine-lime">
              Set up
            </Link>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col items-center gap-1.5 px-4 text-[13px] text-pine-mint2 tnum">
        {day.target && <TargetCaption day={day} unit={unit} onOpen={() => setHowOpen(true)} />}
        <Link href="/goal" className="flex min-h-6 items-center gap-2 text-inherit no-underline">
          <HaloGlyph progress={day.goal?.progress ?? 0} />
          {day.goal ? (
            <span>
              Goal {kg(day.goal.targetKg).replace(/\.0$/, '')} kg by {shortDate(day.goal.targetDate)} · now {kg(day.goal.currentKg)} · pace {kg(day.goal.paceKg)}
            </span>
          ) : (
            <span>Set a weight goal</span>
          )}
        </Link>
        <div className="flex flex-wrap justify-center gap-x-3.5 gap-y-1 pt-1.5">
          <MacroLegend eaten={day.eaten} onSelect={(m) => onBreakdown(m === 'protein' ? 'protein_g' : m === 'carbs' ? 'carbs_g' : m === 'fat' ? 'fat_g' : 'energy_kj')} />
        </div>
      </div>
      {day.target && (
        <Sheet open={howOpen} onClose={() => setHowOpen(false)} label="How today's target is worked out">
          <div className="flex flex-col gap-3 pb-2 text-ink">
            <h2 className="pt-1 text-center text-[17px] font-semibold">How today&apos;s target is worked out</h2>
            <TargetBreakdownCard
              t={day.target}
              unit={unit}
              activityLevel={activityLevel}
              kgToGo={day.goal ? day.goal.targetKg - day.goal.currentKg : null}
            />
            <p className="mx-1 text-[13px] leading-snug text-ink2">{PRECISION_NOTE}</p>
          </div>
        </Sheet>
      )}
    </section>
  );
}

/**
 * Under the ring: the parts of today's target, which add up to the centre's number (before
 * rounding to 10). Lime marks the activity term, as on the ring's rail. Tap for the breakdown.
 */
function TargetCaption({ day, unit, onOpen }: { day: DayView; unit: EnergyUnit; onOpen: () => void }) {
  const c = captionParts(day.target!, unit);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${c.text}. How today's target is worked out`}
      className="flex min-h-11 max-w-full items-center gap-2 whitespace-nowrap border-0 bg-transparent px-1 text-[13px] text-pine-mint2 tnum"
    >
      {!c.own && (
        <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true" className="shrink-0">
          <line x1="2" y1="2" x2="16" y2="2" stroke={P.activityRail} strokeWidth="4" strokeLinecap="round" strokeDasharray={c.kind === 'estimated' ? '0 7' : undefined} />
        </svg>
      )}
      {c.own ? (
        <span className="text-pine-mint">{c.text}</span>
      ) : (
        <span className="truncate">
          <span className="font-medium text-pine-mint">{c.resting}</span> resting
          {c.goal && (
            <>
              {' '}
              {c.goal.sign} <span className="font-medium text-pine-mint">{c.goal.value}</span> goal
            </>
          )}{' '}
          <span className="font-semibold text-pine-lime">+ {c.active}</span> active{c.suffix}
        </span>
      )}
    </button>
  );
}

/** Tap the ring: grams and share of energy for each macro, in the macro colours. */
function GramsCentre({ day }: { day: DayView }) {
  const label = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' } as const;
  return (
    <div className="flex flex-col items-center gap-1">
      {day.macroGrams.map((m) => (
        <span key={m.key} className="text-[15px] font-medium tnum" style={{ color: P[m.key] }}>
          {label[m.key]} {m.grams == null ? '–' : `${grams(m.grams)} g`} · {Math.round(m.share * 100)}%
        </span>
      ))}
      <span className="pt-0.5 text-xs text-pine-mint2">of energy</span>
    </div>
  );
}

function HaloGlyph({ progress }: { progress: number }) {
  const p = Math.min(Math.max(progress, 0), 0.999);
  const a = p * Math.PI * 2 - Math.PI / 2;
  const x = 7 + 5.5 * Math.cos(a);
  const y = 7 + 5.5 * Math.sin(a);
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" fill="none" stroke={P.track2} strokeWidth="2" />
      {p > 0 && <path d={`M7 1.5 A5.5 5.5 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={P.mint3} strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function TargetsCard({ day, unit, onBreakdown }: { day: DayView; unit: EnergyUnit; onBreakdown: (k: NutrientKey) => void }) {
  if (!day.targetRows.length) {
    return (
      <section className="rounded-card bg-surface px-5 py-[18px] shadow-[var(--cc-card-shadow)]">
        <p className="text-[15px] text-ink2">
          No nutrient targets yet.{' '}
          <Link href="/settings#targets" className="font-semibold text-accent">
            Set any you care about
          </Link>
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Targets" className="flex flex-col gap-3.5 rounded-card bg-surface px-5 py-[18px] shadow-[var(--cc-card-shadow)]">
      {day.targetRows.map((r) => {
        const isEnergy = r.info.key === 'energy_kj';
        const isSodium = r.info.key === 'sodium_mg';
        return (
          <button
            key={r.info.key}
            type="button"
            onClick={() => onBreakdown(r.info.key)}
            aria-label={`${r.info.label}: which foods`}
            className="press -mx-2 block w-[calc(100%+16px)] rounded-[14px] border-0 bg-transparent px-2 py-1 text-left text-ink"
          >
          <TargetBar
            name={r.info.label}
            value={r.value}
            unit={isEnergy ? unitLabel(unit) : r.info.unit}
            direction={r.direction}
            min={r.min}
            max={r.max}
            colour={r.info.colour ? `var(--cc-${r.info.colour})` : undefined}
            incomplete={r.incomplete}
            aiEstimates={r.ai}
            format={isEnergy || isSodium ? int : grams}
          />
          </button>
        );
      })}
    </section>
  );
}

function MoreNutrients({ day, onBreakdown }: { day: DayView; onBreakdown: (k: NutrientKey) => void }) {
  const sodium = day.otherNutrients.find((n) => n.info.key === 'sodium_mg');
  const rest = day.otherNutrients.filter((n) => n.info.key !== 'sodium_mg');
  if (!sodium && !rest.length) return null;
  return (
    <section aria-label="More nutrients" className="flex flex-col gap-3 rounded-card bg-surface px-5 py-4 shadow-[var(--cc-card-shadow)]">
      {sodium && (
        <>
          <button
            type="button"
            onClick={() => onBreakdown('sodium_mg')}
            aria-label="Sodium: which foods"
            className="press -mx-2 flex min-h-[26px] w-[calc(100%+16px)] items-baseline justify-between gap-2 rounded-[14px] border-0 bg-transparent px-2 py-1 text-left text-ink"
          >
            <span className="flex items-center gap-2 text-base font-medium">
              Sodium
              {sodium.incomplete > 0 && <DashedChip>incomplete · {sodium.incomplete}</DashedChip>}
              {sodium.ai > 0 && <DashedChip title="Includes AI estimates, not values from data">AI est. · {sodium.ai}</DashedChip>}
            </span>
            <span className="text-[21px] font-medium tnum">
              {sodium.value == null ? '–' : int(sodium.value)} mg{' '}
              {sodium.value != null && <span className="text-sm font-normal text-ink2">({saltText(sodium.value)})</span>}
            </span>
          </button>
          {rest.length > 0 && <div className="h-px bg-separator" />}
        </>
      )}
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {rest.map((n) => (
            <button
              key={n.info.key}
              type="button"
              onClick={() => onBreakdown(n.info.key)}
              aria-label={`${n.info.label}: which foods`}
              className="press -mx-2 flex flex-col items-start gap-0.5 rounded-[14px] border-0 bg-transparent px-2 py-1 text-left text-ink"
            >
              <span className="flex items-center gap-1.5 text-xs text-ink2">
                {n.info.colour && <MacroDot colour={n.info.colour} size={7} />}
                {n.info.label === 'Dietary fibre' ? 'Fibre' : n.info.label}
                {n.incomplete > 0 && <DashedChip>incomplete · {n.incomplete}</DashedChip>}
                {n.ai > 0 && <DashedChip title="Includes AI estimates, not values from data">AI est. · {n.ai}</DashedChip>}
              </span>
              <span className="text-[19px] font-medium tnum">{n.value == null ? '–' : `${n.value >= 100 ? int(n.value) : one(n.value)} g`}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function LogGroup({ group, unit, missingKeys, onEntry, onMenu }: {
  group: DayView['groups'][number];
  unit: EnergyUnit;
  missingKeys: NutrientKey[];
  onEntry: (e: LogEntry) => void;
  onMenu: () => void;
}) {
  const label = MEAL_LABEL[group.meal];
  return (
    <section className="rounded-log-card bg-surface pb-1.5 pl-5 pr-1.5 shadow-[var(--cc-card-shadow)]">
      <div className="flex h-12 items-center gap-1.5">
        <span className="flex-1 text-[17px] font-semibold">{label}</span>
        {group.entries.length > 0 && (
          <span className="text-sm text-ink2 tnum">
            {group.ai > 0 && group.energyKj != null ? '≈ ' : ''}
            {group.energyKj == null ? '–' : `${int(energyIn(group.energyKj, unit))} ${unitLabel(unit)}`}
            {group.incomplete > 0 && ' +'}
          </span>
        )}
        <button
          type="button"
          onClick={onMenu}
          aria-label={`${label} options: Copy, Save these as a meal`}
          className="flex h-11 w-11 items-center justify-center border-0 bg-transparent p-0 text-ink2"
        >
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-raised">
            <MoreDots />
          </span>
        </button>
      </div>
      {group.entries.length === 0 ? (
        <div className="flex h-[46px] items-center border-t border-separator text-[15px] text-ink2">Nothing logged yet</div>
      ) : (
        group.entries.map((e) => {
          const kj = entryEnergyKj(e);
          const gaps = missingKeys.filter((k) => e.per100_snapshot[k] == null).slice(0, 2);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onEntry(e)}
              className="flex min-h-[46px] w-full items-center gap-2.5 border-0 border-t border-separator bg-transparent p-0 py-1.5 pr-3.5 text-left"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px] text-ink">
                <span className="line-clamp-2 min-w-0 leading-snug">{e.food_name_snapshot}</span>
                {isAiEstimate(e) && <DashedChip title="Values are an AI estimate, not from a food database">AI est.</DashedChip>}
                {gaps.map((k) => (
                  <DashedChip key={k} title={`This food has no value for ${NUTRIENT_BY_KEY[k].label.toLowerCase()}`}>
                    {NUTRIENT_BY_KEY[k].short} –
                  </DashedChip>
                ))}
              </span>
              <span className="text-[13px] text-ink2 tnum">
                {e.is_estimate ? '≈ ' : ''}
                {amountText(e.entered_amount, e.entered_unit)}
              </span>
              <span className="w-10 text-right text-[15px] font-medium tnum">{kj == null ? '–' : int(energyIn(kj, unit))}</span>
            </button>
          );
        })
      )}
    </section>
  );
}

/** The fixed bar of four log buttons: Scan, Photo, Search, Type. */
function LogDock({ href }: { href: TodayHandlers['logHref'] }) {
  const items = [
    ['scan', 'Scan', 'scan'],
    ['photo', 'Photo', 'camera'],
    ['search', 'Search', 'search'],
    ['type', 'Type', 'keyboard'],
  ] as const;
  return (
    <nav aria-label="Log food" className="cc-dock cc-dock-fixed grid h-16 grid-cols-4 px-1.5 py-0">
      {items.map(([route, label, icon]) => (
        <Link
          key={route}
          href={href(route)}
          className="press flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-pine-mint no-underline"
        >
          <Icon name={icon} size={26} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
