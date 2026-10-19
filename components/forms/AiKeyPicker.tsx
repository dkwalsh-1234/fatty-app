'use client';

// Bring your own AI key (design 08-ai-key). Three providers as equals: alphabetical, same words,
// same layout, nothing pre-selected, nothing recommended. The key field and Test stay disabled
// until a provider is picked.

import { useState } from 'react';
import { PROVIDER_BY_ID, PROVIDERS, type ProviderId } from '@/lib/ai/config';
import type { AiKeyInfo } from '../app/AppProvider';
import { Button, CapsLabel, Card, cx, Dock, DockButton, Notice } from '../ui';
import { Radio } from './ProfileForm';

export function AiKeyPicker({ current, onSaved, onDeleted, onSkip, dock }: {
  current: AiKeyInfo | null;
  onSaved: (k: AiKeyInfo) => void;
  onDeleted?: () => void;
  /** Onboarding: Skip for now and Save key sit in the dock. */
  onSkip?: () => void;
  dock?: boolean;
}) {
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Only set by Replace and Delete. Whether a key is saved comes from `current`, which can arrive
  // after the first render (the app loads it in the background), so it isn't frozen here.
  const [replacing, setReplacing] = useState(false);

  async function call(save: boolean) {
    if (!provider || !key.trim()) return;
    setBusy(save ? 'save' : 'test');
    setResult(null);
    try {
      const res = await fetch('/api/ai-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, key: key.trim(), save }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string; provider?: ProviderId; model?: string; last4?: string };
      if (!body.ok) {
        setResult({ ok: false, message: body.error ?? "That key didn't work." });
        return;
      }
      if (save) {
        setKey('');
        setReplacing(false);
        onSaved({ provider: body.provider!, key_last4: body.last4!, model: body.model ?? null, verified_at: new Date().toISOString() });
      } else {
        setResult({ ok: true, message: `It works. ${PROVIDER_BY_ID[provider].name} answered.` });
      }
    } catch {
      setResult({ ok: false, message: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      const res = await fetch('/api/ai-key', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setReplacing(true);
      onDeleted?.();
    } catch {
      setResult({ ok: false, message: "Couldn't delete the key. Try again." });
    } finally {
      setBusy(null);
    }
  }

  if (current && !replacing) {
    const p = PROVIDER_BY_ID[current.provider];
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-base">
              <b className="font-semibold">{p.name}</b> <span className="text-ink2">· {p.company}</span>
            </span>
            <span className="block text-[14px] text-ink2 tnum">Your key · ····{current.key_last4}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => setReplacing(true)}>
            Replace
          </Button>
        </div>
        <p className="text-[13px] leading-snug text-ink2">{p.dataUse}</p>
        <Notice tone="warn">{result && !result.ok ? result.message : null}</Notice>
        <div className="flex justify-start">
          <Button variant="warnLink" onClick={remove} disabled={busy === 'delete'}>
            {busy === 'delete' ? 'Deleting…' : 'Delete key'}
          </Button>
        </div>
      </Card>
    );
  }

  const disabled = !provider;
  const canSave = !!provider && key.trim().length > 10 && !busy;

  return (
    <div>
      <CapsLabel className="mt-0">Choose a provider</CapsLabel>
      <Card className="py-2" as="div">
        <div role="radiogroup" aria-label="AI provider">
          {PROVIDERS.map((p) => (
            <div key={p.id} className="flex gap-4 border-t border-separator py-3.5 first:border-t-0">
              <button
                type="button"
                role="radio"
                aria-checked={provider === p.id}
                onClick={() => {
                  setProvider(p.id);
                  setResult(null);
                }}
                className="flex min-w-0 flex-1 gap-4 border-0 bg-transparent p-0 text-left"
              >
                <span className="pt-0.5">
                  <Radio on={provider === p.id} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px]">
                    <b className="font-semibold">{p.name}</b> <span className="text-ink2">· {p.company}</span>
                  </span>
                  <span className="mt-1 block text-[13px] leading-snug text-ink2">{p.dataUse}</span>
                </span>
              </button>
              <a href={p.keyUrl} target="_blank" rel="noreferrer" className="shrink-0 pt-0.5 text-[16px] font-semibold text-accent no-underline">
                Get a key
              </a>
            </div>
          ))}
        </div>
      </Card>

      <CapsLabel className={cx(disabled && 'opacity-60')}>API key</CapsLabel>
      <div className="flex gap-2">
        <label className={cx('flex h-12 min-w-0 flex-1 items-center rounded-[24px] px-5', disabled ? 'bg-raised/50' : 'bg-raised focus-within:shadow-[0_0_0_2.5px_var(--cc-focus),0_0_0_8px_var(--cc-focus-glow)]')}>
          <span className="sr-only">API key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setResult(null);
            }}
            placeholder={provider ? PROVIDER_BY_ID[provider].placeholder : 'Choose a provider first'}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] outline-none disabled:cursor-not-allowed"
          />
        </label>
        <Button size="md" variant="secondary" disabled={disabled || !key.trim() || !!busy} onClick={() => call(false)} className="disabled:bg-raised/50">
          {busy === 'test' ? 'Testing…' : 'Test'}
        </Button>
      </div>
      <Notice tone={result?.ok ? 'neutral' : 'warn'} className="mt-2">
        {result?.message}
      </Notice>

      {dock ? (
        <Dock>
          <DockButton onClick={onSkip}>Skip for now</DockButton>
          <DockButton primary disabled={!canSave} onClick={() => call(true)}>
            {busy === 'save' ? 'Saving…' : 'Save key'}
          </DockButton>
        </Dock>
      ) : (
        <div className="mt-3 flex gap-2">
          {current && (
            <Button size="md" variant="secondary" onClick={() => setReplacing(false)}>
              Cancel
            </Button>
          )}
          <Button size="md" disabled={!canSave} onClick={() => call(true)} className="flex-1">
            {busy === 'save' ? 'Saving…' : 'Save key'}
          </Button>
        </div>
      )}
    </div>
  );
}
