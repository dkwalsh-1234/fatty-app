'use client';

// App-wide state for the signed-in person: profile, goal, weigh-ins, burn, targets and AI key,
// plus the one amount sheet every logging flow lands on.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { inWrapper, readBurn } from '@/lib/bridge';
import { addDays, localDate } from '@/lib/dates';
import { buildDay, type DayView } from '@/lib/day';
import { dayEntries, loadBurn, loadGoal, loadProfile, loadTargets, loadWeighIns, upsertBurn } from '@/lib/data';
import { supabase } from '@/lib/supabase/browser';
import type { BurnRow, Food, FoodStats, Goal, LogEntry, Measure, MealIngredient, Profile, TargetRow, WeighIn } from '@/lib/types';
import { AmountSheet, type AmountRequest } from './AmountSheet';

export interface AiKeyInfo {
  provider: 'anthropic' | 'gemini' | 'deepseek';
  key_last4: string;
  model: string | null;
  verified_at: string | null;
}

/** Sample data for the development-only /dev preview. Never used in production. */
export interface Fixtures {
  goal: Goal | null;
  weighIns: WeighIn[];
  burn: BurnRow[];
  targets: TargetRow[];
  aiKey: AiKeyInfo | null;
  days: Record<string, LogEntry[]>;
  foods: Record<string, { food: Food; measures: Measure[]; stats: FoodStats | null; ingredients?: MealIngredient[] }>;
}

interface AppState {
  fixtures?: Fixtures;
  email: string;
  isAdmin: boolean;
  profile: Profile;
  goal: Goal | null;
  weighIns: WeighIn[];
  burn: BurnRow[];
  targets: TargetRow[];
  aiKey: AiKeyInfo | null;
  /** Local date now, in the person's zone. Rolls over at midnight. */
  today: string;
  /** Bumps whenever the log changes, so day views refetch. */
  logVersion: number;
  loaded: boolean;
  reload: (what?: ('profile' | 'goal' | 'weighIns' | 'burn' | 'targets' | 'aiKey')[]) => Promise<void>;
  setProfile: (p: Profile) => void;
  openAmount: (req: AmountRequest) => void;
  syncBurn: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export function AppProvider({ initial, fixtures, children }: {
  initial: { email: string; isAdmin: boolean; profile: Profile };
  fixtures?: Fixtures;
  children: ReactNode;
}) {
  const [profile, setProfile] = useState(initial.profile);
  const [goal, setGoal] = useState<Goal | null>(fixtures?.goal ?? null);
  const [weighIns, setWeighIns] = useState<WeighIn[]>(fixtures?.weighIns ?? []);
  const [burn, setBurn] = useState<BurnRow[]>(fixtures?.burn ?? []);
  const [targets, setTargets] = useState<TargetRow[]>(fixtures?.targets ?? []);
  const [aiKey, setAiKey] = useState<AiKeyInfo | null>(fixtures?.aiKey ?? null);
  const [loaded, setLoaded] = useState(!!fixtures);
  const [today, setToday] = useState(() => localDate(initial.profile.time_zone));
  const [logVersion, setLogVersion] = useState(0);
  const [amount, setAmount] = useState<{ req: AmountRequest; n: number } | null>(null);
  const tz = profile.time_zone;

  const reload = useCallback<AppState['reload']>(
    async (what = ['profile', 'goal', 'weighIns', 'burn', 'targets', 'aiKey']) => {
      const tasks: Promise<unknown>[] = [];
      if (what.includes('profile')) tasks.push(loadProfile().then(setProfile));
      if (what.includes('goal')) tasks.push(loadGoal().then(setGoal));
      if (what.includes('weighIns')) tasks.push(loadWeighIns().then(setWeighIns));
      if (what.includes('burn')) tasks.push(loadBurn(addDays(localDate(tz), -40)).then(setBurn));
      if (what.includes('targets')) tasks.push(loadTargets().then(setTargets));
      if (what.includes('aiKey'))
        tasks.push(
          Promise.resolve(supabase().rpc('my_ai_key')).then(({ data }) => setAiKey(((data as AiKeyInfo[]) ?? [])[0] ?? null)),
        );
      await Promise.allSettled(tasks);
    },
    [tz],
  );

  // Calories burned from Health Connect, per source app, never summed. Runs on app open.
  const syncBurn = useCallback(async () => {
    if (!inWrapper()) return;
    const r = await readBurn(7);
    if (!r || r.error || !r.permission) return;
    const rows: BurnRow[] = r.days.flatMap((d) =>
      d.sources.map((s) => ({ date: d.date, source_app: s.app, total_kcal: s.total_kcal, active_kcal: s.active_kcal })),
    );
    await upsertBurn(rows).catch(() => {});
    await reload(['burn']);
  }, [reload]);

  useEffect(() => {
    if (fixtures) return;
    let live = true;
    void reload(['goal', 'weighIns', 'burn', 'targets', 'aiKey']).then(() => live && setLoaded(true));
    void syncBurn();
    return () => {
      live = false;
    };
  }, [reload, syncBurn, fixtures]);

  useEffect(() => {
    const onChange = () => setLogVersion((v) => v + 1);
    window.addEventListener('fatty:log-changed', onChange);
    // Roll "today" over just after midnight, and when the app comes back to the foreground.
    const tick = () => setToday(localDate(tz));
    const timer = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.removeEventListener('fatty:log-changed', onChange);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [tz]);

  const value = useMemo<AppState>(
    () => ({
      fixtures,
      email: initial.email,
      isAdmin: initial.isAdmin,
      profile,
      goal,
      weighIns,
      burn,
      targets,
      aiKey,
      today,
      logVersion,
      loaded,
      reload,
      setProfile,
      openAmount: (req: AmountRequest) => setAmount({ req, n: Date.now() }),
      syncBurn,
    }),
    [fixtures, initial.email, initial.isAdmin, profile, goal, weighIns, burn, targets, aiKey, today, logVersion, loaded, reload, syncBurn],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {amount && <AmountSheet key={amount.n} request={amount.req} onClose={() => setAmount(null)} />}
    </Ctx.Provider>
  );
}

/** One local day's log and everything worked out from it. Refetches when the log changes. */
export function useDay(date: string): { day: DayView | null; entries: LogEntry[]; loading: boolean; error: string | null; reload: () => void } {
  const app = useApp();
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (app.fixtures) return;
    let live = true;
    dayEntries(date)
      .then((e) => {
        if (!live) return;
        setEntries(e);
        setError(null);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [date, app.logVersion, nonce, app.fixtures]);

  const shown = useMemo(() => (app.fixtures ? (app.fixtures.days[date] ?? []) : entries), [app.fixtures, date, entries]);
  const day = useMemo(
    () =>
      shown && app.loaded
        ? buildDay({ date, entries: shown, profile: app.profile, goal: app.goal, weighIns: app.weighIns, burn: app.burn, targets: app.targets })
        : null,
    [shown, app.loaded, date, app.profile, app.goal, app.weighIns, app.burn, app.targets],
  );
  return { day, entries: shown ?? [], loading: shown == null, error, reload: () => setNonce((n) => n + 1) };
}
