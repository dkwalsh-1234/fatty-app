// The browser side of "Let AI pick" (Search and meal confirm, the same AI matching as Type) and
// "Use an AI estimate" (Q5). Both run only when the person asks, never on type-ahead, and need
// their AI key.

import { NO_KEY_MESSAGE } from './ai/errors';
import type { Candidate, Draft } from './drafts';

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

/** The AI's foods and amounts for what was typed. */
export const aiDraft = (text: string) => post<{ draft: Draft }>('/api/parse-text', { text }).then((b) => b.draft);

/** The same, left where meal confirm looks; returns the address to go to. */
export async function aiPick(text: string, date?: string): Promise<string> {
  const draft = await aiDraft(text);
  const key = Date.now().toString(36);
  sessionStorage.setItem(`fatty:draft:text:${key}`, JSON.stringify(draft));
  const q = new URLSearchParams({ text: key });
  if (date) q.set('d', date);
  return `/log/confirm?${q}`;
}

export const aiEstimate = (phrase: string) => post<{ candidate: Candidate }>('/api/estimate-food', { phrase }).then((b) => b.candidate);
