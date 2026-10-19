'use client';

// The Android wrapper's JavaScript bridge (docs/android-bridge.md). In a normal browser there is
// no window.FoodBridge, every call here is a no-op, and the web app works as usual.

import { NUTRIENT_KEYS, scale } from './nutrients';
import type { LogEntry } from './types';

interface NativeBridge {
  version(): string;
  syncEntries(requestId: string, json: string): void;
  deleteEntries(requestId: string, json: string): void;
  readBurn(requestId: string, days: string): void;
  updateWidget(json: string): void;
  healthConnectStatus(requestId: string): void;
  requestHealthPermissions(requestId: string, scope: string): void;
  openHealthConnectSettings(): void;
}

declare global {
  interface Window {
    FoodBridge?: NativeBridge;
    __fattyBridge?: { resolve(id: string, json: string): void };
  }
}

const pending = new Map<string, (v: unknown) => void>();

function native(): NativeBridge | null {
  if (typeof window === 'undefined' || !window.FoodBridge) return null;
  window.__fattyBridge ??= {
    resolve(id, json) {
      const done = pending.get(id);
      if (!done) return;
      pending.delete(id);
      try {
        done(JSON.parse(json));
      } catch {
        done({ error: 'Bad reply from the app' });
      }
    },
  };
  return window.FoodBridge;
}

export const inWrapper = () => native() != null;

function call<T>(fn: (b: NativeBridge, id: string) => void, timeoutMs = 20_000): Promise<T | null> {
  const b = native();
  if (!b) return Promise.resolve(null);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(id);
      resolve({ error: 'The app took too long to answer' } as T);
    }, timeoutMs);
    pending.set(id, (v) => {
      clearTimeout(t);
      resolve(v as T);
    });
    try {
      fn(b, id);
    } catch (e) {
      clearTimeout(t);
      pending.delete(id);
      resolve({ error: e instanceof Error ? e.message : 'Bridge call failed' } as T);
    }
  });
}

export interface SyncEntry {
  id: string;
  updated_at: string;
  eaten_at: string;
  time_zone: string;
  meal: string;
  name: string;
  nutrients: Record<string, number | null>;
}

/** One Health Connect nutrition record per entry, scaled to the grams eaten; unknowns left unset. */
export function toSyncEntry(e: LogEntry, tz: string): SyncEntry {
  const n = scale(e.per100_snapshot, e.grams);
  return {
    id: e.id,
    updated_at: e.updated_at,
    eaten_at: e.eaten_at,
    time_zone: tz,
    meal: e.meal,
    name: e.food_name_snapshot,
    nutrients: Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n[k] == null ? null : Math.round((n[k] as number) * 1000) / 1000])),
  };
}

export const syncEntries = (entries: SyncEntry[]) =>
  call<{ synced: string[]; failed: string[]; error?: string }>((b, id) => b.syncEntries(id, JSON.stringify(entries)), 60_000);

export const deleteHealthEntries = (ids: string[]) =>
  call<{ deleted: string[]; error?: string }>((b, id) => b.deleteEntries(id, JSON.stringify(ids)));

export interface BurnResult {
  days: { date: string; sources: { app: string; label?: string; total_kcal: number | null; active_kcal: number | null }[] }[];
  permission: boolean;
  error?: string;
}

export const readBurn = (days: number) => call<BurnResult>((b, id) => b.readBurn(id, String(days)), 30_000);

export interface HealthStatus {
  available: boolean;
  needsUpdate: boolean;
  writeNutrition: boolean;
  readTotalCalories: boolean;
  readActiveCalories: boolean;
  lastSyncAt: string | null;
  error?: string;
}

export const healthStatus = () => call<HealthStatus>((b, id) => b.healthConnectStatus(id));
export const requestHealthPermissions = (scope: 'write' | 'read') =>
  call<HealthStatus>((b, id) => b.requestHealthPermissions(id, scope), 120_000);
export const openHealthSettings = () => native()?.openHealthConnectSettings();

export interface WidgetSummary {
  date: string;
  time_zone: string;
  unit: 'KCAL' | 'KJ';
  target: number;
  base: number;
  eaten: { protein: number; carbs: number; fat: number; other: number };
  remaining: number;
  activity: 'measured' | 'estimated' | 'none';
  nutrients: { name: string; value: string; unit: string; caption: string | null; tone: 'neutral' | 'near' | 'over' }[];
  base_url: string;
}

export function updateWidget(summary: WidgetSummary) {
  try {
    native()?.updateWidget(JSON.stringify(summary));
  } catch {
    // The widget is a convenience; never let it break the page.
  }
}
