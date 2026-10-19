'use client';

import { ACTIVITY_LABELS, type ActivityLevel, type Sex } from '@/lib/target';
import { Card, cx, Field, Segmented } from '../ui';

export interface ProfileValues {
  display_name: string;
  birth_date: string;
  sex: Sex | '';
  height_cm: string;
  activity_level: ActivityLevel | '';
  /** Only asked in onboarding; later weigh-ins come from Today. */
  weight_kg?: string;
}

export function profileErrors(v: ProfileValues, withWeight: boolean): string | null {
  if (!v.birth_date || !/^\d{4}-\d{2}-\d{2}$/.test(v.birth_date)) return 'Add your date of birth.';
  const age = new Date().getFullYear() - Number(v.birth_date.slice(0, 4));
  if (age < 13 || age > 110) return 'Check your date of birth.';
  if (!v.sex) return 'Choose female or male for the calorie formula.';
  const h = Number(v.height_cm);
  if (!(h >= 100 && h <= 250)) return 'Add your height in centimetres.';
  if (withWeight) {
    const w = Number(String(v.weight_kg).replace(',', '.'));
    if (!(w >= 25 && w <= 400)) return 'Add your current weight in kilograms.';
  }
  if (!v.activity_level) return 'Choose how active you usually are.';
  return null;
}

export function ProfileForm({ value, onChange, withWeight }: { value: ProfileValues; onChange: (v: ProfileValues) => void; withWeight: boolean }) {
  const set = <K extends keyof ProfileValues>(k: K, v: ProfileValues[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4">
        <Field label="Your name" value={value.display_name} onChange={(e) => set('display_name', e.target.value)} autoComplete="given-name" />
        <Field label="Date of birth" type="date" value={value.birth_date} onChange={(e) => set('birth_date', e.target.value)} hint="So your age stays current." />
        <div>
          <span className="mb-1.5 block text-[15px] text-ink2">Sex</span>
          <Segmented
            label="Sex"
            value={value.sex || ('' as Sex)}
            onChange={(v) => set('sex', v)}
            options={[
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
            ]}
          />
        </div>
        <Field
          label="Height"
          unit="cm"
          inputMode="decimal"
          value={value.height_cm}
          onChange={(e) => set('height_cm', e.target.value.replace(/[^\d.]/g, ''))}
        />
        {withWeight && (
          <Field
            label="Current weight"
            unit="kg"
            inputMode="decimal"
            value={value.weight_kg ?? ''}
            onChange={(e) => set('weight_kg', e.target.value.replace(/[^\d.,]/g, ''))}
          />
        )}
        <p className="-mt-1 px-1 text-[13px] leading-snug text-ink2">Sex and height are needed by the calorie formula (Mifflin-St Jeor).</p>
      </Card>

      <Card className="py-3">
        <p className="pb-1 pt-1 text-[15px] text-ink2">How active are you, usually?</p>
        <div role="radiogroup" aria-label="Activity level">
          {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={value.activity_level === k}
              onClick={() => set('activity_level', k)}
              className="flex min-h-12 w-full items-center gap-3 border-0 border-t border-separator bg-transparent py-2 text-left first:border-t-0"
            >
              <Radio on={value.activity_level === k} />
              <span className="text-base">{ACTIVITY_LABELS[k]}</span>
            </button>
          ))}
        </div>
        <p className="pb-1 pt-2 text-[13px] leading-snug text-ink2">
          Only used when there&apos;s no measured burn from your watch or phone through Health Connect.
        </p>
      </Card>
    </div>
  );
}

export function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-[2.5px]', on ? 'border-accent' : 'border-ink2')}
    >
      {on && <span className="h-3 w-3 rounded-full bg-accent" />}
    </span>
  );
}
