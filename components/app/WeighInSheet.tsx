'use client';

import { useState } from 'react';
import { addWeighIn } from '@/lib/data';
import { kg } from '@/lib/format';
import { Button, Field, Sheet } from '../ui';
import { useApp } from './AppProvider';

/** Weigh-in: tap, type weight, Save. The latest weigh-in drives the target. */
export function WeighInSheet({ open, onClose, lastKg }: { open: boolean; onClose: () => void; lastKg: number | null }) {
  const app = useApp();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(value.replace(',', '.'));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!(n > 20 && n < 400)) {
      setError('Type your weight in kilograms.');
      return;
    }
    setSaving(true);
    try {
      await addWeighIn(Math.round(n * 10) / 10);
      await app.reload(['weighIns']);
      setValue('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Log your weight">
      <form onSubmit={save} className="flex flex-col gap-4 pb-2 pt-2">
        <h2 className="text-center text-[18px] font-semibold">Weigh-in</h2>
        <Field
          label="Weight"
          unit="kg"
          inputMode="decimal"
          enterKeyHint="done"
          autoFocus
          placeholder={lastKg ? kg(lastKg) : '80.0'}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
          error={error}
          hint="Your latest weigh-in sets today's target."
        />
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </Sheet>
  );
}
