'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo } from 'react';
import GoalPage from '@/app/(app)/goal/page';
import TodayPage from '@/app/(app)/page';
import SettingsPage from '@/app/(app)/settings/page';
import { AppProvider, useApp } from '@/components/app/AppProvider';
import { AiKeyPicker } from '@/components/forms/AiKeyPicker';
import { RoundButton, Screen } from '@/components/ui';
import { KEY_SCREEN_COPY } from '@/lib/ai/config';
import { localDate } from '@/lib/dates';
import { devFixtures, devProfile } from './fixtures';

/** ?screen=today (add &d=YYYY-MM-DD for another day) | sheet | sheet-ml | sheet-meal | goal | settings | aikey */
type ScreenName = 'today' | 'sheet' | 'sheet-ml' | 'sheet-meal' | 'goal' | 'settings' | 'aikey';

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
  const fixtures = useMemo(() => devFixtures(today), [today]);
  return (
    <AppProvider initial={{ email: 'daniel@example.com', isAdmin: true, profile: devProfile }} fixtures={fixtures}>
      {screen === 'goal' ? (
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
