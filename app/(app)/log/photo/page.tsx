'use client';

// Photo: the camera with a Meal / Label switch. Meal → optional one-line hint → AI lists items with
// grams → meal confirm. Label → the label photo flow. Without an AI key, Meal shows
// "Add an AI key to use this"; typing a label in by hand still works.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { CameraCapture } from '@/components/app/CameraCapture';
import { BackButton, Button, Card, Icon, Notice, Screen, Segmented, Spinner } from '@/components/ui';
import { NO_KEY_MESSAGE } from '@/lib/ai/errors';
import { uploadPhoto } from '@/lib/camera';
import { LABEL_PHOTO_BUCKET, MEAL_PHOTO_BUCKET } from '@/lib/config';
import type { Draft } from '@/lib/drafts';

export default function PhotoPage() {
  return (
    <Suspense fallback={null}>
      <Photo />
    </Suspense>
  );
}

function Photo() {
  const app = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const date = params.get('d');
  const [mode, setMode] = useState<'meal' | 'label'>(params.get('mode') === 'label' ? 'label' : 'meal');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; settings?: boolean } | null>(null);

  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams(extra);
    if (date) p.set('d', date);
    return p.toString();
  };

  async function onPhoto(blob: Blob) {
    if (mode === 'label') {
      setBusy('Uploading…');
      try {
        const path = await uploadPhoto(LABEL_PHOTO_BUCKET, 'label', blob);
        router.replace(`/log/label?${q({ photo: path })}`);
      } catch (e) {
        setBusy(null);
        setError({ message: e instanceof Error ? e.message : "Couldn't upload the photo." });
      }
      return;
    }
    setPhoto(blob);
  }

  async function send() {
    if (!photo) return;
    setError(null);
    setBusy('Uploading…');
    try {
      const path = await uploadPhoto(MEAL_PHOTO_BUCKET, 'meal', photo);
      setBusy('Looking at your meal…');
      const res = await fetch('/api/meal-photo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo_path: path, hint: hint.trim() || null }),
      });
      const body = (await res.json()) as { draft?: Draft; error?: string; settings?: boolean };
      if (!res.ok || !body.draft) throw Object.assign(new Error(body.error ?? 'That didn\'t work.'), { settings: body.settings });
      sessionStorage.setItem(`fatty:draft:${body.draft.meal_photo_id}`, JSON.stringify(body.draft));
      router.replace(`/log/confirm?${q({ photo: body.draft.meal_photo_id! })}`);
    } catch (e) {
      setBusy(null);
      setError({ message: e instanceof Error ? e.message : "That didn't work.", settings: (e as { settings?: boolean }).settings });
    }
  }

  // Meal photos need an AI key. Label photos don't: without a key the form opens for typing.
  if (mode === 'meal' && !app.aiKey && app.loaded) {
    return (
      <Screen dock={false}>
        <div className="flex h-[60px] items-center">
          <BackButton />
        </div>
        <Card className="mt-6 flex flex-col gap-3">
          <p className="text-[17px] font-semibold">{NO_KEY_MESSAGE}</p>
          <p className="text-[15px] leading-snug text-ink2">
            Reading meal photos uses your own AI key. Search, barcode scanning and typing a label in by hand all work without one.
          </p>
          <Link href="/settings#ai" className="font-semibold text-accent">
            Add a key in Settings
          </Link>
        </Card>
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="secondary" onClick={() => setMode('label')}>
            Photograph a label instead
          </Button>
          <Button variant="secondary" onClick={() => router.replace(`/log/search${date ? `?d=${date}` : ''}`)}>
            Search instead
          </Button>
        </div>
      </Screen>
    );
  }

  if (photo && preview) {
    return (
      <Screen dock={false}>
        <div className="flex h-[60px] items-center justify-between">
          <BackButton />
          <Button variant="link" onClick={() => setPhoto(null)} disabled={!!busy}>
            Retake
          </Button>
        </div>
        <div className="relative overflow-hidden rounded-card bg-photo-placeholder">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Your meal" className="block max-h-[52dvh] w-full object-cover" />
          <label className="cc-dock absolute inset-x-3 bottom-3 flex h-[52px] items-center gap-2 pl-5 pr-1.5">
            <span className="sr-only">Hint (optional)</span>
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              autoFocus
              enterKeyHint="send"
              onKeyDown={(e) => e.key === 'Enter' && void send()}
              placeholder="Optional hint: “chicken stir-fry, 1 tbsp oil”"
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[16px] text-pine-mint outline-none placeholder:text-pine-mint2"
            />
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pine-pine text-pine-lime" title="Use the microphone on your keyboard to dictate">
              <Icon name="mic" size={18} stroke={1.9} />
            </span>
          </label>
        </div>
        <p className="mx-1 mt-2 text-[13px] leading-snug text-ink2">A hint helps more than anything else. Tap the microphone on your keyboard to say it.</p>
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
        <div className="mt-4">
          {busy ? (
            <div className="flex h-[54px] items-center justify-center gap-3 text-ink2">
              <Spinner label={busy} /> {busy}
            </div>
          ) : (
            <Button className="w-full" onClick={send}>
              {error ? 'Retry' : 'Send'}
            </Button>
          )}
        </div>
      </Screen>
    );
  }

  return (
    <CameraCapture
      onPhoto={onPhoto}
      onBack={() => router.back()}
      busy={!!busy}
      hint={busy ?? error?.message ?? (mode === 'label' ? 'Photograph the nutrition information panel' : 'Fit the whole plate in')}
      bottom={
        <div className="w-full max-w-[280px]">
          <Segmented
            label="What are you photographing?"
            tone="glass"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'meal', label: 'Meal' },
              { value: 'label', label: 'Label' },
            ]}
          />
        </div>
      }
    />
  );
}
