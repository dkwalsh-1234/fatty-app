import { cssVar, tokens } from '../tokens/tokens';
import { grams } from './format';

// A nutrient row with its target, as on Today (cream card in light, pine surface in dark).
// Theme-aware: colours come from the CSS variables in tokens.css.
const C = cssVar.theme;

export type TargetDirection = 'atLeast' | 'noMoreThan' | 'range';

export interface TargetBarProps {
  name: string;
  /** Today's total of the known values. null when nothing logged today has a value for this nutrient. */
  value: number | null;
  unit: string;
  direction: TargetDirection;
  /** atLeast and noMoreThan use max for the single target; range uses min and max. */
  min?: number;
  max: number;
  /** Bar colour for atLeast and range rows: a macro colour from the theme, e.g. cssVar.theme.protein. */
  colour?: string;
  /** Number of today's entries with this nutrient missing (null). Shows the "incomplete · n" chip. */
  incomplete?: number;
  /** Number of today's entries whose value here is an AI estimate. Shows the "AI est. · n" chip. */
  aiEstimates?: number;
  /** Number format for the value and captions. Defaults to grams(): 112, 6.4, 38. */
  format?: (n: number) => string;
}

type Tone = 'neutral' | 'near' | 'over';

export function targetState({ value, direction, min = 0, max, unit = 'g', format = grams }: Pick<TargetBarProps, 'value' | 'direction' | 'min' | 'max' | 'unit' | 'format'>) {
  const v = value ?? 0;
  const u = (n: number) => `${format(n)} ${unit}`;
  if (direction === 'atLeast') {
    const reached = v >= max;
    return { tone: 'neutral' as Tone, fill: Math.min(v / max, 1), reached, caption: reached ? 'Reached' : `${u(max - v)} to go` };
  }
  if (direction === 'noMoreThan') {
    const r = v / max;
    if (v > max) return { tone: 'over' as Tone, fill: 1, reached: false, caption: `▲ ${u(v - max)} over` };
    return { tone: (r >= tokens.bar.nearLimit ? 'near' : 'neutral') as Tone, fill: r, reached: false, caption: `${u(max - v)} left` };
  }
  const scale = max * tokens.bar.rangeScale;
  const caption = v < min ? `${u(min - v)} below the range` : v > max ? `${u(v - max)} above the range` : 'In range';
  return { tone: 'neutral' as Tone, fill: Math.min(v / scale, 1), reached: v >= min && v <= max, caption, band: { left: min / scale, width: (max - min) / scale } };
}

export function TargetBar(props: TargetBarProps) {
  const { name, value, unit, direction, min, max, colour = C.ink2, incomplete = 0, aiEstimates = 0, format = grams } = props;
  const st = targetState(props);
  const of = direction === 'range' ? `/ ${format(min ?? 0)}–${format(max)}` : direction === 'noMoreThan' ? `/ ${format(max)} max` : `/ ${format(max)}`;
  const warnText = st.tone !== 'neutral';
  const barBg =
    st.tone === 'over'
      ? `repeating-linear-gradient(135deg, ${C.warn} 0 3px, ${C.warnTail} 3px 6px)`
      : st.tone === 'near'
        ? C.warn
        : direction === 'noMoreThan'
          ? C.ink3
          : colour;
  const caption = st.caption;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', minHeight: 26 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 500 }}>
          {name}
          {incomplete > 0 && (
            <span title={`${incomplete} of today's entries have no value for ${name.toLowerCase()}`} style={{ fontSize: 11, fontWeight: 600, color: C.ink2, border: `1.5px dashed ${C.ink3}`, borderRadius: 9, padding: '0 7px' }}>
              incomplete · {incomplete}
            </span>
          )}
          {aiEstimates > 0 && (
            <span title={`${aiEstimates} of today's entries have an AI estimate for ${name.toLowerCase()}, not a value from data`} style={{ fontSize: 11, fontWeight: 600, color: C.ink2, border: `1.5px dashed ${C.ink3}`, borderRadius: 9, padding: '0 7px' }}>
              AI est. · {aiEstimates}
            </span>
          )}
        </span>
        <span style={{ fontSize: 21, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: st.tone === 'over' ? C.warnText : C.ink }}>
          {value == null ? '–' : format(value)} {unit}{' '}
          <span style={{ fontSize: 14, fontWeight: 400, color: C.ink2 }}>{of}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={direction === 'range' ? max * tokens.bar.rangeScale : max}
        aria-valuenow={value ?? 0}
        aria-valuetext={`${value == null ? 'no value' : format(value) + ' ' + unit}, ${caption}${incomplete ? ', incomplete' : ''}${aiEstimates ? ', includes AI estimates' : ''}`}
        style={{ position: 'relative', height: tokens.bar.height, borderRadius: tokens.radius.bar, overflow: 'hidden', background: C.track }}
      >
        {st.band && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${st.band.left * 100}%`, width: `${st.band.width * 100}%`, background: C.range }} />
        )}
        <div
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: tokens.radius.bar,
            width: `${st.fill * 100}%`, background: barBg, opacity: st.tone === 'near' ? tokens.bar.nearOpacity : 1,
          }}
        />
      </div>
      <span style={{ alignSelf: 'flex-end', fontSize: 12, lineHeight: '15px', color: warnText ? C.warnText : C.ink2, fontWeight: st.tone === 'over' ? 600 : 400 }}>
        {st.reached && direction === 'atLeast' ? '✓ ' : ''}
        {caption}
      </span>
    </div>
  );
}
