'use client';

// Camera, barcode reading and photo uploads in the browser (and the Android WebView).

import { PHOTO_MAX_PX } from './config';
import { supabase } from './supabase/browser';

export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
  native: boolean;
}

/**
 * The browser's built-in BarcodeDetector where it exists (Chrome on Android uses Play Services);
 * otherwise a JavaScript/WASM reader with the same API, loaded from our own server.
 */
export async function getDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? BARCODE_FORMATS;
      const formats = BARCODE_FORMATS.filter((f) => supported.includes(f));
      if (formats.length) {
        const d = new Native({ formats: [...formats] });
        return { detect: (s) => d.detect(s), native: true };
      }
    } catch {
      // Fall through to the WASM reader.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? `/zxing/${path}` : prefix + path) },
  });
  const d = new BarcodeDetector({ formats: [...BARCODE_FORMATS] });
  return { detect: (s) => d.detect(s as ImageBitmapSource) as Promise<{ rawValue: string; format: string }[]>, native: false };
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play().catch(() => {});
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function torchSupported(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
  return !!caps?.torch;
}

export async function setTorch(stream: MediaStream | null, on: boolean) {
  const track = stream?.getVideoTracks()[0];
  await track?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

export function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is off. Allow it in your browser or app settings, or type the barcode.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found.';
  return 'The camera did not start.';
}

/** Downscale to about 1,024 px on the longest side, as JPEG. */
async function toJpeg(source: CanvasImageSource, w: number, h: number, maxPx = PHOTO_MAX_PX): Promise<Blob> {
  const k = Math.min(1, maxPx / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't process the photo.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the photo."))), 'image/jpeg', 0.86));
}

export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  return toJpeg(video, video.videoWidth, video.videoHeight);
}

export async function downscaleFile(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions).catch(() => null);
  if (bmp) return toJpeg(bmp, bmp.width, bmp.height);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return toJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Upload to the person's own folder in a private bucket. Returns the storage path. */
export async function uploadPhoto(bucket: string, kind: 'meal' | 'label', blob: Blob): Promise<string> {
  const sb = supabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error('Please sign in again.');
  const path = `${data.user.id}/${kind}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Couldn't upload the photo: ${error.message}`);
  return path;
}

export async function signedPhotoUrl(bucket: string, path: string): Promise<string | null> {
  const { data } = await supabase().storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export function vibrate(ms = 40) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not supported; fine.
  }
}
