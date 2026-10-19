'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';
import ConfirmPage from '@/app/(app)/log/confirm/page';
import GoalPage from '@/app/(app)/goal/page';
import TodayPage from '@/app/(app)/page';
import SettingsPage from '@/app/(app)/settings/page';
import { AppProvider, useApp } from '@/components/app/AppProvider';
import { AiKeyPicker } from '@/components/forms/AiKeyPicker';
import { RoundButton, Screen } from '@/components/ui';
import { KEY_SCREEN_COPY } from '@/lib/ai/config';
import { localDate } from '@/lib/dates';
import { devFixtures, devProfile } from './fixtures';

/** ?screen=today (add &d=YYYY-MM-DD for another day) | sheet | sheet-ml | sheet-meal | goal | settings | aikey | confirm (&text=dev-unmatched or dev-mixed); &key=1 gives the sample account a saved AI key */
type ScreenName = 'today' | 'sheet' | 'sheet-ml' | 'sheet-meal' | 'goal' | 'settings' | 'aikey' | 'confirm';

export function DevPreview() {
  return (
    <Suspense fallback={null}>
      <Preview />
    </Suspense>
  );
}

function Preview() {
  const params = useSearchParams();
  const screen = (params.get('screen') ?? 'today') as ScreenName;
  const today = localDate(devProfile.time_zone);
  const withKey = params.get('key') === '1';
  const fixtures = useMemo(
    () => ({ ...devFixtures(today), aiKey: withKey ? { provider: 'anthropic' as const, key_last4: '7AAA', model: null, verified_at: '2026-10-19T19:49:59Z' } : null }),
    [today, withKey],
  );
  return (
    <AppProvider initial={{ email: 'daniel@example.com', isAdmin: true, profile: devProfile }} fixtures={fixtures}>
      {screen === 'confirm' ? (
        <ConfirmPage />
      ) : screen === 'goal' ? (
        <GoalPage />
      ) : screen === 'settings' ? (
        <SettingsPage />
      ) : screen === 'aikey' ? (
        <AiKeyStep />
      ) : (
        <>
          <TodayPage />
          <OpenSheet screen={screen} />
        </>
      )}
    </AppProvider>
  );
}

// Sample drafts for the meal confirm screen, put where the Type screen would leave them.
if (typeof window !== 'undefined') {
  const item = (key: string, label: string, grams: number | null, candidates: unknown[]) => ({
    key, label, query: label, grams, estimate: true, confidence: null, suggested: false, note: null, candidates,
  });
  const flatWhite = {
    id: 'fw', name: 'Coffee, flat white/cappuccino/latte, single shot & cereal based milk (rice/oat)', display_name: null, brand: null, source: 'ausnut',
    is_liquid: true, density_g_per_ml: 1.03, serving_g: null, energy_kj: 160, protein_g: 0.4, fat_g: 1.3, sat_fat_g: 0.2, trans_fat_g: 0,
    carbs_g: 5.1, sugars_g: 2.4, fibre_g: 0.4, sodium_mg: 40, last_grams: null,
  };
  sessionStorage.setItem('fatty:draft:text:dev-unmatched', JSON.stringify({ kind: 'text', text: '8 oz flat white with oat milk', items: [item('u1', 'Flat white (oat milk)', 237, [])] }));
  sessionStorage.setItem('fatty:draft:text:dev-mixed', JSON.stringify({ kind: 'text', text: '8 oz flat white with oat milk, a mystery muffin', items: [item('m1', 'Flat white (oat milk)', 227, [flatWhite]), item('m2', 'Mystery muffin', 110, [])] }));
}

function OpenSheet({ screen }: { screen: string }) {
  const app = useApp();
  useEffect(() => {
    const id = screen === 'sheet' ? 'salad' : screen === 'sheet-ml' ? 'milk' : screen === 'sheet-meal' ? 'meal-pasta' : null;
    if (!id) return;
    const f = app.fixtures!.foods[id];
    app.openAmount({ kind: 'food', foodId: id, food: f.food, method: 'search', afterSave: 'stay' });
    // Open once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
  return null;
}

/** Onboarding step 3, as designed in 08-ai-key. */
function AiKeyStep() {
  return (
    <Screen>
      <header className="flex h-[60px] items-center justify-between">
        <div className="-ml-1">
          <RoundButton icon="back" label="Back" />
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-2 w-9 rounded-full ${i === 2 ? 'bg-ink dark:bg-pine-lime' : 'bg-ink3/50'}`} />
          ))}
        </div>
      </header>
      <h1 className="mb-3 mt-3 px-1 text-[30px] font-semibold leading-[1.15] tracking-[-0.025em]">Add an AI key</h1>
      <p className="mb-3 px-1 text-[16px] leading-[1.45]">{KEY_SCREEN_COPY.intro}</p>
      <p className="mb-5 px-1 text-[15px] leading-[1.45] text-ink2">{KEY_SCREEN_COPY.billing}</p>
      <AiKeyPicker current={null} onSaved={() => {}} onSkip={() => {}} dock />
    </Screen>
  );
}
