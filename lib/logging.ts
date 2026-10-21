'use client';

// Saving and deleting log entries, plus the Health Connect side effects in the Android wrapper.

import { deleteHealthEntries, inWrapper, syncEntries, toSyncEntry } from './bridge';
import { deleteEntries, logEntries, markSynced, moveEntriesToCorrectedFood, updateEntry, type NewEntry } from './data';
import type { Food, LogEntry } from './types';

/** Tell the rest of the app the log changed (Today refreshes, the widget updates). */
export function announceLogChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fatty:log-changed'));
}

export async function syncToHealth(entries: LogEntry[], tz: string): Promise<void> {
  if (!inWrapper() || !entries.length) return;
  const r = await syncEntries(entries.map((e) => toSyncEntry(e, tz)));
  if (r?.synced?.length) await markSynced(r.synced);
}

export async function saveEntries(entries: NewEntry[], tz: string): Promise<LogEntry[]> {
  const saved = await logEntries(entries);
  announceLogChanged();
  void syncToHealth(saved, tz);
  return saved;
}

export async function saveEntryEdit(id: string, patch: Partial<NewEntry>, tz: string): Promise<LogEntry> {
  const saved = await updateEntry(id, patch);
  announceLogChanged();
  void syncToHealth([saved], tz);
  return saved;
}

/** "Update your N entries logged from the old values?": yes. Health Connect gets the new values. */
export async function correctEntries(oldFoodId: string, food: Food, tz: string): Promise<number> {
  const updated = await moveEntriesToCorrectedFood(oldFoodId, food);
  announceLogChanged();
  void syncToHealth(updated, tz);
  return updated.length;
}

export async function removeEntries(ids: string[]): Promise<void> {
  await deleteEntries(ids);
  announceLogChanged();
  if (inWrapper()) void deleteHealthEntries(ids);
}
