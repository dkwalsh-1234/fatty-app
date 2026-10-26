import { useId, type ReactNode } from 'react';
import { tokens } from '../tokens/tokens';
import { ringGeometry, type ActivityKind, type MacroEnergy } from './ring';
import { int } from './format';

// The ring always sits on pine (the hero band in light mode, the page in dark mode),
// so it uses the fixed pine colours in both themes.
const P = tokens.color.pine;

export const RING_SIZES = {
  today: tokens.ring.today,
  widget: tokens.ring.widget,
  spec: tokens.ring.spec,
} as const;

export interface EnergyRingProps {
  /** 'today' (280 / 26), 'widget' (136 / 15) or 'spec' (140 / 15). */
  variant?: keyof typeof RING_SIZES;
  /** Today's target, kcal (or kJ if the user chose kJ; keep every value in one unit). */
  target: number;
  /** Resting + goal adjustment, without activity. */
  base: number;
  /** Eaten energy split by macro (see splitEnergy in ring.ts). */
  eaten: MacroEnergy;
  activity: ActivityKind;
  /** Goal mini-map: fractions from start weight to goal weight (see goalFractions). Omit to hide. */
  goal?: { progress: number; pace: number } | null;
  /** Unit label for the centre, "KCAL" or "KJ". */
  unit?: string;
  /** Tap the ring to switch the centre to grams and share of energy (brief). */
  onToggle?: () => void;
  /** Replaces the default centre (kcal left or over). */
  children?: ReactNode;
}

export function EnergyRing({ variant = 'today', target, base, eaten, activity, goal, unit = 'KCAL', onToggle, children }: EnergyRingProps) {
  const id = useId().replace(/:/g, '');
  const s = RING_SIZES[variant];
  const g = ringGeometry({ size: s.size, stroke: s.stroke, rail: s.rail, inset: s.inset, target, base, eaten, activity, goal });
  const colour: Record<keyof MacroEnergy, string> = { protein: P.protein, carbs: P.carbs, fat: P.fat, other: P.other };
  const small = s.size < 200;

  const label = g.over
    ? `${int(-g.remaining)} ${unit.toLowerCase()} over today's target of ${int(target)}`
    : `${int(g.remaining)} ${unit.toLowerCase()} left of ${int(target)}`;
  const parts = `Protein ${int(eaten.protein)}, carbohydrate ${int(eaten.carbs)}, fat ${int(eaten.fat)}, other ${int(eaten.other)}.`;
  const act = activity === 'none' ? '' : ` ${int(target - base)} of the target is from ${activity === 'estimated' ? 'estimated ' : ''}activity.`;

  const svg = (
    <svg width={s.size} height={s.size} viewBox={`0 0 ${s.size} ${s.size}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <filter id={`${id}-seg`} filterUnits="userSpaceOnUse" x={-12} y={-12} width={s.size + 24} height={s.size + 24}>
          <feDropShadow dx="0" dy="0" stdDeviation={small ? 1.5 : 2} floodColor="rgb(0, 20, 12)" floodOpacity="0.6" />
        </filter>
        <filter id={`${id}-lap`} filterUnits="userSpaceOnUse" x={-12} y={-12} width={s.size + 24} height={s.size + 24}>
          <feDropShadow dx="2" dy="0" stdDeviation={small ? 2 : 2.5} floodColor="rgb(0, 20, 12)" floodOpacity="0.85" />
        </filter>
      </defs>
      <circle cx={g.cx} cy={g.cx} r={g.r} fill="none" stroke={P.track} strokeWidth={g.stroke} />
      {g.activity && (
        <path d={g.activity.d} fill="none" stroke={P.activityRail} strokeWidth={g.activity.width} strokeLinecap="round" strokeDasharray={g.activity.dash} />
      )}
      {g.segments.map((seg) => (
        <path key={seg.key} d={seg.d} fill="none" stroke={colour[seg.key]} strokeWidth={g.stroke} strokeLinecap="round" filter={`url(#${id}-seg)`} />
      ))}
      {g.lap && <path d={g.lap} fill="none" stroke={P.warn} strokeWidth={g.stroke} strokeLinecap="round" filter={`url(#${id}-lap)`} />}
      {g.halo && (
        <g>
          <circle cx={g.cx} cy={g.cx} r={g.halo.r} fill="none" stroke={P.track} strokeWidth={tokens.ring.halo.stroke} />
          {g.halo.progress && <path d={g.halo.progress} fill="none" stroke={P.mint3} strokeWidth={tokens.ring.halo.stroke} strokeLinecap="round" />}
          <circle cx={g.halo.pace.x} cy={g.halo.pace.y} r={tokens.ring.halo.paceDot} style={{ fill: `var(--cc-band, ${P.band})` }} stroke={P.mint3} strokeWidth={tokens.ring.halo.paceStroke} />
          <circle cx={g.halo.now.x} cy={g.halo.now.y} r={tokens.ring.halo.nowDot} fill={P.mint} />
        </g>
      )}
    </svg>
  );

  const centre = children ?? (
    <EnergyCentre remaining={g.remaining} eaten={g.eatenTotal} target={target} unit={unit} estimated={activity === 'estimated'} compact={small} />
  );

  const box = { position: 'relative', width: s.size, height: s.size, color: P.mint } as const;
  const inner = (
    <>
      {svg}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>{centre}</div>
    </>
  );

  return onToggle ? (
    <button type="button" onClick={onToggle} aria-label={`${label}. ${parts}${act} Tap to show grams and share of energy.`} style={{ ...box, border: 0, padding: 0, background: 'none', font: 'inherit', cursor: 'pointer' }}>
      {inner}
    </button>
  ) : (
    <div role="img" aria-label={`${label}. ${parts}${act}`} style={box}>
      {inner}
    </div>
  );
}

/** Default centre: kcal left (or over), with eaten and target below. */
export function EnergyCentre({ remaining, eaten, target, unit = 'KCAL', estimated = false, compact = false }: {
  remaining: number; eaten: number; target: number; unit?: string; estimated?: boolean; compact?: boolean;
}) {
  const over = remaining < 0;
  const dial = compact ? 36 : tokens.type.dial.size;
  return (
    <>
      <span style={{ fontSize: dial, fontWeight: 300, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: over ? P.warn : P.mint }}>
        {int(Math.abs(remaining))}
      </span>
      <span style={{ fontSize: compact ? 10 : 12, fontWeight: 600, letterSpacing: '0.08em', paddingTop: compact ? 3 : 4, color: over ? P.warn : compact ? P.mint2 : P.mint }}>
        {over ? `▲ ${unit} OVER` : `${unit} LEFT${estimated ? ' · EST.' : ''}`}
      </span>
      {!compact && (
        <span style={{ fontSize: 13, color: P.mint2, paddingTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {int(eaten)} of {int(target)}
        </span>
      )}
    </>
  );
}

/**
 * The line under the ring: "2,180 target · +410 from activity", with a rail glyph that matches the ring.
 * Not designed for the estimated case beyond the dotted glyph and "est." (brief: "labelled est.").
 */
export function RingCaption({ target, activityKcal, activity }: { target: number; activityKcal: number; activity: ActivityKind }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: P.mint2, fontVariantNumeric: 'tabular-nums' }}>
      {activity !== 'none' && (
        <svg width="18" height="4" viewBox="0 0 18 4" aria-hidden="true">
          <line x1="2" y1="2" x2="16" y2="2" stroke={P.activityRail} strokeWidth="4" strokeLinecap="round" strokeDasharray={activity === 'estimated' ? '0 7' : undefined} />
        </svg>
      )}
      <span>
        <span style={{ color: P.mint, fontWeight: 500 }}>{int(target)}</span> target
        {activity !== 'none' && (
          <>
            {' · '}
            <span style={{ color: P.lime, fontWeight: 600 }}>+{int(activityKcal)}</span> from activity{activity === 'estimated' ? ', est.' : ''}
          </>
        )}
      </span>
    </span>
  );
}

/** Macro legend under the ring: dot, name, kcal. */
/** With onSelect, each item is a button (Today: tap to see which foods made it up). */
export function MacroLegend({ eaten, onSelect }: { eaten: MacroEnergy; onSelect?: (macro: 'protein' | 'carbs' | 'fat' | 'other') => void }) {
  const items = [
    ['protein', 'Protein', P.protein, eaten.protein],
    ['carbs', 'Carbs', P.carbs, eaten.carbs],
    ['fat', 'Fat', P.fat, eaten.fat],
    ['other', 'Other', P.other, eaten.other],
  ] as const;
  const itemStyle = { display: 'flex', alignItems: 'center', gap: 6, color: P.mint } as const;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, rowGap: 4, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
      {items.map(([key, name, col, kcal]) => {
        const inner = (
          <>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, background: col }} />
            {name}
            <span style={{ color: P.mint2 }}>{int(kcal)}</span>
          </>
        );
        return onSelect ? (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-label={`${name} ${int(kcal)}: which foods`}
            style={{ ...itemStyle, minHeight: 32, padding: '0 4px', border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer' }}
          >
            {inner}
          </button>
        ) : (
          <span key={key} style={itemStyle}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
