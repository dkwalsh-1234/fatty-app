// Plain, specific messages for AI failures. Key and quota problems point to Settings.

export type AiErrorKind = 'invalid_key' | 'quota' | 'rate_limit' | 'bad_output' | 'unavailable' | 'network' | 'refused' | 'no_key' | 'other';

export class AiError extends Error {
  constructor(
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
  /** Worth one automatic retry. */
  get transient() {
    return this.kind === 'bad_output' || this.kind === 'network' || this.kind === 'unavailable';
  }
  /** The fix is in Settings (a key problem). */
  get settings() {
    return this.kind === 'invalid_key' || this.kind === 'quota' || this.kind === 'no_key';
  }
}

export const NO_KEY_MESSAGE = 'Add an AI key to use this';
