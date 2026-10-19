// The AI layer with provider HTTP mocked: same prompts and schemas for every provider, plain
// error messages, one retry on a bad answer, and keys sealed so they can't be read back.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADAPTERS } from '@/lib/ai/adapters';
import { PROVIDERS } from '@/lib/ai/config';
import { open, seal } from '@/lib/ai/crypto';
import { AiError } from '@/lib/ai/errors';
import { labelPrompt, mealPrompt, textPrompt } from '@/lib/ai/prompts';
import { runAi } from '@/lib/ai/run';
import { geminiSchema, jsonSchema, LabelSchema, MealPhotoSchema } from '@/lib/ai/schemas';

const SECRET = 'x'.repeat(40);

afterEach(() => vi.unstubAllGlobals());

function mockFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  });
  return calls;
}

const label = {
  product_name: 'Untoasted fruit muesli',
  brand: null,
  basis: 'per_100g',
  per_100: { energy_kj: 1620, energy_kcal_only: null, protein_g: 10.2, fat_g: 8.9, sat_fat_g: null, trans_fat_g: 0, carbs_g: 58.4, sugars_g: 17.6, fibre_g: 9.1, sodium_mg: 15 },
  serving_size: 45,
  serving_unit: 'g',
  servings_per_pack: 16.7,
  derived_from_per_serve: false,
};

describe('providers as equals', () => {
  it('lists the three alphabetically with the same fields', () => {
    expect(PROVIDERS.map((p) => p.name)).toEqual(['Claude', 'DeepSeek', 'Gemini']);
    for (const p of PROVIDERS) {
      expect(p.dataUse.startsWith('Data use for API traffic:')).toBe(true);
      expect(p.keyUrl).toMatch(/^https:\/\//);
      expect(p.model).toBeTruthy();
    }
  });

  it('says what the brief requires in every prompt', () => {
    expect(labelPrompt({ hasFront: false })).toMatch(/Never estimate a number/);
    expect(labelPrompt({ hasFront: false })).toMatch(/return null/);
    const meal = mealPrompt('chicken stir-fry, 1 tbsp oil');
    expect(meal).toMatch(/actually visible on the plate/);
    expect(meal).toMatch(/Treat this as true where it conflicts/);
    expect(meal).toMatch(/hidden fats/);
    expect(meal).toMatch(/Return no calories/);
    expect(textPrompt('2 eggs')).toMatch(/count and count_noun/);
  });
});

describe('schemas', () => {
  it("converts to Gemini's OpenAPI style with nullable fields", () => {
    const s = geminiSchema(LabelSchema) as { properties: Record<string, { nullable?: boolean; type?: string; properties?: Record<string, { nullable?: boolean }> }> };
    expect(s.properties.product_name).toMatchObject({ type: 'string', nullable: true });
    expect(s.properties.per_100.properties!.sat_fat_g.nullable).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/anyOf|additionalProperties|\$schema/);
    expect(JSON.stringify(jsonSchema(MealPhotoSchema))).not.toMatch(/calories|energy/);
  });
});

describe('key sealing', () => {
  it('round-trips with the secret and fails without it', () => {
    const sealed = seal('AIzaSyExampleKey1234567890abcdefgh', SECRET);
    expect(sealed).not.toContain('AIza');
    expect(open(sealed, SECRET)).toBe('AIzaSyExampleKey1234567890abcdefgh');
    expect(open(sealed, 'y'.repeat(40))).toBeNull();
  });
});

describe('Gemini adapter', () => {
  it('sends the image inline with a JSON schema at temperature 0.1 and the key in a header', async () => {
    const calls = mockFetch([{ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(label) }] } }] } }]);
    const out = await runAi({ provider: 'gemini', model: 'gemini-3.8-flash', key: 'k' }, { system: 's', prompt: 'p', images: [{ mime: 'image/jpeg', base64: 'AAA' }], schema: LabelSchema });
    expect(out.per_100.sat_fat_g).toBeNull();
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toContain('/models/gemini-3.8-flash:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(calls[0].url).not.toContain('key=');
    expect(body.generationConfig.temperature).toBe(0.1);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'AAA' });
  });

  it('gives a plain message for a bad key', async () => {
    mockFetch([{ status: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } } }]);
    const err = await runAi({ provider: 'gemini', model: 'm', key: 'k' }, { system: 's', prompt: 'p', schema: LabelSchema }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('invalid_key');
    expect(err.message).toBe("Your Gemini key didn't work. Check it in Settings.");
    expect(err.settings).toBe(true);
  });
});

describe('DeepSeek adapter', () => {
  it('sends the image as a data URL in JSON mode', async () => {
    const calls = mockFetch([{ status: 200, body: { choices: [{ message: { content: JSON.stringify(label) } }] } }]);
    await runAi({ provider: 'deepseek', model: 'deepseek-flash', key: 'sk-1' }, { system: 's', prompt: 'p', images: [{ mime: 'image/jpeg', base64: 'BBB' }], schema: LabelSchema });
    const body = JSON.parse(calls[0].init.body as string);
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.1);
    expect(body.messages[1].content[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBB' } });
    expect(body.messages[1].content[1].text).toMatch(/JSON Schema/);
  });

  it('points to Settings when the account is out of credit', async () => {
    mockFetch([{ status: 402, body: { error: { message: 'Insufficient Balance' } } }]);
    const err = await runAi({ provider: 'deepseek', model: 'm', key: 'k' }, { system: 's', prompt: 'p', schema: LabelSchema }).catch((e) => e);
    expect(err.kind).toBe('quota');
    expect(err.settings).toBe(true);
  });
});

describe('one retry, then a clear error', () => {
  it('retries a malformed answer once', async () => {
    const calls = mockFetch([
      { status: 200, body: { choices: [{ message: { content: '{"oops": true}' } }] } },
      { status: 200, body: { choices: [{ message: { content: JSON.stringify(label) } }] } },
    ]);
    const out = await runAi({ provider: 'deepseek', model: 'm', key: 'k' }, { system: 's', prompt: 'p', schema: LabelSchema });
    expect(out.product_name).toBe('Untoasted fruit muesli');
    expect(calls).toHaveLength(2);
  });

  it('gives up after the second bad answer and never retries a key problem', async () => {
    const bad = mockFetch([{ status: 200, body: { choices: [{ message: { content: 'not json' } }] } }]);
    const err = await runAi({ provider: 'deepseek', model: 'm', key: 'k' }, { system: 's', prompt: 'p', schema: LabelSchema }).catch((e) => e);
    expect(err.kind).toBe('bad_output');
    expect(bad).toHaveLength(2);
    const auth = mockFetch([{ status: 401, body: {} }]);
    await runAi({ provider: 'deepseek', model: 'm', key: 'k' }, { system: 's', prompt: 'p', schema: LabelSchema }).catch(() => {});
    expect(auth).toHaveLength(1);
  });

  it('tests a key with a tiny call', async () => {
    const calls = mockFetch([{ status: 200, body: { choices: [{ message: { content: 'OK' } }] } }]);
    await ADAPTERS.deepseek.test('sk-abc', 'deepseek-flash');
    expect(JSON.parse(calls[0].init.body as string).max_tokens).toBe(16);
  });
});
