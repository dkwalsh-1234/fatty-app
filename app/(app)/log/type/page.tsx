'use client';

// Typed or dictated text: "45 g salad, 2 eggs, flat white, 30 g almonds". Works with Gboard voice
// typing as it is. Parsed locally when every item has an amount and an obvious match; otherwise
// the person's own AI key splits it. Either way it lands on the meal confirm screen.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { BackButton, Card, Dock, DockButton, Notice, Screen } from '@/components/ui';
import { NO_KEY_MESSAGE } from '@/lib/ai/errors';
import type { Draft } from '@/lib/drafts';
import { allHaveAmounts, parseText } from '@/lib/parse';

export default function TypePage() {
  return (
    <Suspense fallback={null}>
      <TypeMeal />
    </Suspense>
  );
}

function TypeMeal() {
  const app = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const date = params.get('d');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; settings?: boolean } | null>(null);
  const noKey = app.loaded && !app.aiKey;
  const local = allHaveAmounts(parseText(text));

  async function go() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/parse-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const body = (await res.json()) as { draft?: Draft; error?: string; settings?: boolean; kind?: string };
      if (!res.ok || !body.draft) {
        const message = body.kind === 'no_key' ? `${NO_KEY_MESSAGE}, or give every item an amount and a clear name, like “45 g salad”.` : (body.error ?? "That didn't work.");
        throw Object.assign(new Error(message), { settings: body.settings });
      }
      const key = Date.now().toString(36);
      sessionStorage.setItem(`fatty:draft:text:${key}`, JSON.stringify(body.draft));
      const q = new URLSearchParams({ text: key });
      if (date) q.set('d', date);
      router.push(`/log/confirm?${q}`);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "That didn't work.", settings: (e as { settings?: boolean }).settings });
      setBusy(false);
    }
  }

  return (
    <Screen>
      <header className="-mx-1 flex h-14 items-center justify-between">
        <BackButton />
        <span className="text-base font-semibold">Type what you ate</span>
        <span className="w-11" />
      </header>
      <label className="block">
        <span className="sr-only">What you ate</span>
        <textarea
          autoFocus
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void go();
            }
          }}
          enterKeyHint="go"
          placeholder="45 g salad, 2 eggs, flat white, 30 g almonds"
          className="block w-full resize-none rounded-card border-0 bg-surface px-5 py-4 text-[18px] leading-snug shadow-[var(--cc-card-shadow)] outline-none focus:shadow-[0_0_0_2.5px_var(--cc-focus),0_0_0_8px_var(--cc-focus-glow)]"
        />
      </label>
      <p className="mx-1 mt-2 text-[13px] leading-snug text-ink2">
        Separate items with commas. Tap the microphone on your keyboard to say it instead.
        {local && ' Every item has an amount, so this may not need AI at all.'}
      </p>

      {noKey && (
        <Card className="mt-4">
          <p className="text-[16px] font-semibold">{NO_KEY_MESSAGE}</p>
          <p className="mt-1 text-[14px] leading-snug text-ink2">
            Without a key, this still works when every item has an amount and a clear name. Counts like “2 eggs” and items without an amount need a key.
          </p>
          <Link href="/settings#ai" className="mt-2 inline-block font-semibold text-accent">
            Add a key in Settings
          </Link>
        </Card>
      )}

      <Notice tone="warn" className="mt-3">
        {error?.message}
        {error?.settings && (
          <>
            {' '}
            <Link href="/settings#ai" className="font-semibold text-accent">
              Settings
            </Link>
          </>
        )}
      </Notice>
      <Dock>
        <DockButton primary onClick={go} disabled={busy || !text.trim()}>
          {busy ? 'Working it out…' : error ? 'Retry' : 'Continue'}
        </DockButton>
      </Dock>
    </Screen>
  );
}
