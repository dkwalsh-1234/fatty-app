// The browser side of the AI fallbacks: "Ask AI to find this" (item 4) and "Use an AI estimate"
// (Q5). Both run only when the person taps them, never on type-ahead, and need their AI key.

import { NO_KEY_MESSAGE } from './ai/errors';
import type { Candidate } from './drafts';
import type { ResolveResponse } from './resolution';

export class AiCallError extends Error {
  constructor(
    message: string,
    /** The fix is in Settings (no key, or a key problem). */
    public settings: boolean,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new AiCallError("Couldn't reach the server. Try again.", false);
  }
  const b = (await res.json().catch(() => ({}))) as { error?: string; kind?: string; settings?: boolean };
  if (!res.ok) throw new AiCallError(b.kind === 'no_key' ? NO_KEY_MESSAGE : (b.error ?? "That didn't work. Try again."), !!b.settings);
  return b as T;
}

export const askAiToFind = (phrase: string, grams: number | null) => post<ResolveResponse>('/api/resolve-food', { phrase, grams });

export const aiEstimate = (phrase: string) => post<{ candidate: Candidate }>('/api/estimate-food', { phrase }).then((b) => b.candidate);
