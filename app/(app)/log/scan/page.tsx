'use client';

// Scanner: full-screen camera with a framing box. A read normalises the barcode and looks it up:
// your foods, the shared catalogue, then Open Food Facts. A miss goes straight to the label photo
// flow, carrying the barcode along.

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/app/AppProvider';
import { Button, Icon, Spinner } from '@/components/ui';
import { normalizeBarcode } from '@/lib/barcode';
import { cameraErrorMessage, getDetector, setTorch, startCamera, stopCamera, torchSupported, vibrate } from '@/lib/camera';
import { toFood } from '@/lib/data';

export default function ScanPage() {
  return (
    <Suspense fallback={null}>
      <Scanner />
    </Suspense>
  );
}

function Scanner() {
  const app = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const date = params.get('d') ?? undefined;
  const forMeal = params.get('for'); // "ingredient": hand the food back to the meal editor
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busy = useRef(false);
  const [torch, setTorchOn] = useState(false);
  const [canTorch, setCanTorch] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<string | null>('Starting the camera…');
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(
    async (raw: string, format?: string) => {
      const code = normalizeBarcode(raw, format);
      if (!code) {
        setError("That doesn't look like a product barcode. Check the digits.");
        busy.current = false;
        return;
      }
      setStatus('Looking it up…');
      setError(null);
      try {
        const res = await fetch(`/api/barcode/${code}${format ? `?format=${format}` : ''}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'Lookup failed.');
        if (body.miss) {
          stopCamera(streamRef.current);
          const q = new URLSearchParams({ barcode: code, reason: body.reason });
          if (date) q.set('d', date);
          if (forMeal) q.set('for', forMeal);
          router.replace(`/log/label?${q}`);
          return;
        }
        const food = toFood(body.food);
        if (forMeal) {
          sessionStorage.setItem('fatty:picked-ingredient', JSON.stringify({ id: food.id, at: Date.now() }));
          router.back();
          return;
        }
        setStatus(null);
        app.openAmount({
          kind: 'food',
          foodId: food.id,
          food,
          method: 'barcode',
          date,
          // Closed without saving: carry on scanning.
          onCancel: () => setTimeout(() => (busy.current = false), 600),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Lookup failed.');
        setStatus(null);
        busy.current = false;
      }
    },
    [app, date, forMeal, router],
  );

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const video = videoRef.current!;
        const stream = await startCamera(video);
        if (!live) return stopCamera(stream);
        streamRef.current = stream;
        setCanTorch(torchSupported(stream));
        setStatus(null);
        const detector = await getDetector();
        const loop = async () => {
          if (!live) return;
          if (!busy.current && video.readyState >= 2) {
            try {
              const found = await detector.detect(video);
              const hit = found.find((f) => /^\d{6,14}$/.test(f.rawValue));
              if (hit && !busy.current) {
                busy.current = true;
                vibrate();
                await lookup(hit.rawValue, hit.format);
              }
            } catch {
              // A frame that can't be read; try the next one.
            }
          }
          timer = setTimeout(loop, 180);
        };
        void loop();
      } catch (e) {
        if (!live) return;
        setStatus(null);
        setError(cameraErrorMessage(e));
        setTyping(true);
      }
    })();
    return () => {
      live = false;
      clearTimeout(timer);
      stopCamera(streamRef.current);
    };
  }, [lookup]);

  const labelHref = `/log/label?mode=nobarcode${date ? `&d=${date}` : ''}${forMeal ? `&for=${forMeal}` : ''}`;

  return (
    <main className="fixed inset-0 overflow-hidden bg-pine-pine text-pine-mint">
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" aria-label="Camera" />
      {/* Pine scrim at 60% outside a 260 × 160 framing box with lime corners. */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[38%] h-[160px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-[24px] shadow-[0_0_0_200vmax_rgba(8,30,23,0.6)]">
        {['left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-[24px]', 'right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-[24px]', 'left-0 bottom-0 border-b-[3px] border-l-[3px] rounded-bl-[24px]', 'right-0 bottom-0 border-b-[3px] border-r-[3px] rounded-br-[24px]'].map((c) => (
          <span key={c} className={`absolute h-9 w-9 border-pine-lime ${c}`} />
        ))}
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button type="button" aria-label="Back" onClick={() => router.back()} className="cc-dock press flex h-11 w-11 items-center justify-center rounded-full border-0 p-0">
          <Icon name="back" size={18} stroke={2.2} />
        </button>
        {canTorch && (
          <button
            type="button"
            aria-label={torch ? 'Torch off' : 'Torch on'}
            aria-pressed={torch}
            onClick={async () => {
              await setTorch(streamRef.current, !torch).catch(() => {});
              setTorchOn(!torch);
            }}
            className={`cc-dock press flex h-11 w-11 items-center justify-center rounded-full border-0 p-0 ${torch ? 'text-pine-lime' : ''}`}
          >
            <Icon name="torch" size={20} />
          </button>
        )}
      </div>

      <div className="absolute inset-x-0 top-[calc(38%+100px)] flex flex-col items-center gap-2 px-6 text-center">
        {status && (
          <span className="flex items-center gap-2 text-[15px] text-pine-mint2">
            <Spinner label={status} /> {status}
          </span>
        )}
        {!status && !error && <span className="text-[15px] text-pine-mint2">Line the barcode up in the box</span>}
        {error && <span role="alert" className="text-[15px] text-pine-warn">{error}</span>}
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-[max(24px,env(safe-area-inset-bottom))]">
        {typing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy.current) {
                busy.current = true;
                void lookup(typed);
              }
            }}
            className="cc-dock flex w-full max-w-[420px] gap-1.5"
          >
            <label className="flex h-[52px] min-w-0 flex-1 items-center rounded-[28px] bg-pine-raised px-5">
              <span className="sr-only">Barcode digits</span>
              <input
                inputMode="numeric"
                autoFocus
                value={typed}
                onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 14))}
                placeholder="Barcode digits"
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-[18px] text-pine-mint outline-none placeholder:text-pine-mint3 tnum"
              />
            </label>
            <button type="submit" disabled={typed.length < 8} className="press h-[52px] rounded-[28px] border-0 bg-pine-lime px-5 text-[17px] font-semibold text-pine-on-lime disabled:bg-pine-raised disabled:text-pine-mint3">
              Look up
            </button>
          </form>
        ) : (
          <Button variant="link" className="!text-pine-mint" onClick={() => setTyping(true)}>
            Type barcode
          </Button>
        )}
        <Link href={labelHref} className="min-h-11 py-2 text-[16px] font-semibold text-pine-mint no-underline">
          No barcode? Photograph the label
        </Link>
      </div>
    </main>
  );
}
