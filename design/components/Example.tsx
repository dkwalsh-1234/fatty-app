// Usage example with the design's sample day (Monday 19 October). Not app code.
import { cssVar } from '../tokens/tokens';
import { EnergyRing, MacroLegend, RingCaption } from './EnergyRing';
import { TargetBar } from './TargetBar';
import { goalFractions, type MacroEnergy } from './ring';

const today: MacroEnergy = { protein: 455, carbs: 569, fat: 394, other: 42 }; // kcal, 1,460 eaten
const over: MacroEnergy = { protein: 414, carbs: 947, fat: 1003, other: 46 }; // kcal, 2,410 eaten

// Start 88.0 kg on 31 Aug, now 86.6, goal 84 kg by 20 Dec -> progress 0.35, pace 0.44 (86.2 kg)
const goal = goalFractions({
  startKg: 88.0, currentKg: 86.6, goalKg: 84,
  startDate: new Date('2026-08-31'), goalDate: new Date('2026-12-20'), today: new Date('2026-10-19'),
});

export function TodayTopExample({ scenario = 'today' }: { scenario?: 'today' | 'over' }) {
  const eaten = scenario === 'over' ? over : today;
  return (
    <div style={{ background: 'var(--cc-band)', color: 'var(--cc-pine-mint)', padding: '8px 0 24px', borderRadius: '0 0 36px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <EnergyRing target={2180} base={1770} eaten={eaten} activity="measured" goal={goal} onToggle={() => {}} />
      <RingCaption target={2180} activityKcal={410} activity="measured" />
      <MacroLegend eaten={eaten} />
    </div>
  );
}

export function TargetsExample({ scenario = 'today' }: { scenario?: 'today' | 'over' }) {
  const o = scenario === 'over';
  return (
    <section style={{ background: cssVar.theme.surface, color: cssVar.theme.ink, borderRadius: 26, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: cssVar.theme.cardShadow }}>
      <TargetBar name="Protein" value={o ? 102 : 112} unit="g" direction="atLeast" max={150} colour={cssVar.theme.protein} />
      <TargetBar name="Saturated fat" value={o ? 26.7 : 6.4} unit="g" direction="noMoreThan" max={7} incomplete={o ? 1 : 0} />
      <TargetBar name="Carbohydrate" value={o ? 233 : 140} unit="g" direction="range" min={150} max={250} colour={cssVar.theme.carbs} />
    </section>
  );
}

export function WidgetRingExample() {
  return <EnergyRing variant="widget" target={2180} base={1770} eaten={today} activity="measured" />;
}
