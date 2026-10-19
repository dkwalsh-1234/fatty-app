// The three AI providers, offered as equals: same words, same layout, nothing pre-selected,
// nothing recommended. Model names and data-use notes change often; this file is the one place
// to update them. Shown alphabetically by name.
//
// Checked 19 October 2026:
// - Claude: claude-haiku-5-5 is Anthropic's current small model with image input.
// - DeepSeek: deepseek-flash (V4.1 Flash) takes images. The older experimental vision model name
//   (deepseek-v4-flash-vision-exp) is retired and now served by deepseek-flash.
// - Gemini: gemini-3.8-flash is Google's current stable Flash model with image input.

export type ProviderId = 'anthropic' | 'deepseek' | 'gemini';

export interface ProviderConfig {
  id: ProviderId;
  /** Shown first, bold: "Claude". */
  name: string;
  /** Shown after it: "Anthropic". */
  company: string;
  model: string;
  keyUrl: string;
  /** One line on what the provider does with API prompts and images. Keep current. */
  dataUse: string;
  /** Rough shape check before the test call, so a pasted typo gets a quick answer. */
  keyHint: RegExp;
  placeholder: string;
}

export const PROVIDERS: readonly ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Claude',
    company: 'Anthropic',
    model: 'claude-haiku-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    dataUse: "Data use for API traffic: Anthropic doesn't train on API prompts or images unless you send feedback or opt in.",
    keyHint: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    placeholder: 'sk-ant-…',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    company: 'DeepSeek',
    model: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    dataUse: 'Data use for API traffic: DeepSeek may use prompts and images to train its models (you can opt out by email) and stores data in China.',
    keyHint: /^sk-[A-Za-z0-9]{20,}$/,
    placeholder: 'sk-…',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    company: 'Google',
    model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    dataUse: "Data use for API traffic: on Google's free tier, prompts and images may be used to improve its products and read by reviewers; on the paid tier they aren't.",
    keyHint: /^[A-Za-z0-9_-]{30,}$/,
    placeholder: 'AIza…',
  },
] as const;

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderConfig>;

/** The same words for every provider, shown above the list. */
export const KEY_SCREEN_COPY = {
  intro:
    'A key lets the app read labels, meal photos and typed meals. Search, barcode scanning, typing a label in by hand and saved meals all work without one.',
  billing:
    'An AI chat subscription does not include API access. API keys are separate and billed per use by each provider. Your key is stored encrypted and used only on the server; afterwards you will only see its last four characters.',
};

/** Shared settings for every call: low temperature (where the model allows it), one pass, JSON out. */
export const AI_CALL = {
  temperature: 0.1,
  maxOutputTokens: 2000,
  timeoutMs: 45_000,
};
