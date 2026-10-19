'use client';

// Full-bleed camera with a shutter, for meal and label photos. Falls back to the phone's own
// camera app (<input capture>) or the gallery when live camera access isn't available.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cameraErrorMessage, captureFrame, downscaleFile, setTorch, startCamera, stopCamera, torchSupported } from '@/lib/camera';
import { Icon } from '../ui';

export function CameraCapture({ onPhoto, onBack, hint, bottom, busy }: {
  onPhoto: (blob: Blob) => void;
  onBack: () => void;
  /** A line over the preview ("Photograph the nutrition panel"). */
  hint?: ReactNode;
  /** Extra controls under the shutter (the Meal / Label switch). */
  bottom?: ReactNode;
  busy?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canTorch, setCanTorch] = useState(false);
  const [torch, setTorchOn] = useState(false);

  useEffect(() => {
    let active = true;
    startCamera(videoRef.current!)
      .then((s) => {
        if (!active) return stopCamera(s);
        streamRef.current = s;
        setLive(true);
        setCanTorch(torchSupported(s));
      })
      .catch((e) => active && setError(cameraErrorMessage(e)));
    return () => {
      active = false;
      stopCamera(streamRef.current);
    };
  }, []);

  async function shoot() {
    if (busy) return;
    if (!live) return fileRef.current?.click();
    try {
      onPhoto(await captureFrame(videoRef.current!));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't take the photo.");
    }
  }

  async function fromFile(f: File | undefined) {
    if (!f) return;
    try {
      onPhoto(await downscaleFile(f));
    } catch {
      setError("Couldn't read that photo.");
    }
  }

  return (
    <main className="fixed inset-0 overflow-hidden bg-pine-pine text-pine-mint">
      <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" aria-label="Camera preview" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 pt-[max(12px,env(safe-area-inset-top))]">
        <button type="button" aria-label="Back" onClick={onBack} className="cc-dock press flex h-11 w-11 items-center justify-center rounded-full border-0 p-0">
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
      {(hint || error) && (
        <div className="absolute inset-x-0 top-[72px] flex justify-center px-6 text-center">
          <span className={`cc-dock rounded-[22px] px-4 py-2 text-[15px] ${error ? 'text-pine-warn' : ''}`} role={error ? 'alert' : undefined}>
            {error ?? hint}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-4 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="flex w-full max-w-[420px] items-center justify-between">
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            aria-label="Choose a photo from the gallery"
            className="cc-dock press flex h-12 w-12 items-center justify-center rounded-full border-0 p-0"
          >
            <Icon name="image" size={22} />
          </button>
          <button
            type="button"
            onClick={shoot}
            disabled={busy}
            aria-label="Take photo"
            className="press flex h-[76px] w-[76px] items-center justify-center rounded-full border-[4px] border-pine-mint bg-transparent p-0 disabled:opacity-50"
          >
            <span className="h-[60px] w-[60px] rounded-full bg-pine-mint" />
          </button>
          <span className="h-12 w-12" />
        </div>
        {bottom}
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
      <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files?.[0])} />
    </main>
  );
}
