import "server-only";

// One adapter per provider, sharing the same prompts and schemas. Each takes the signed-in
// person's own key, decrypted only for this request, and returns parsed JSON or an AiError.

import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { AI_CALL, PROVIDER_BY_ID, type ProviderId } from "./config";
import { AiError } from "./errors";
import { geminiSchema, jsonSchema } from "./schemas";

export interface AiImage {
  mime: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}

export interface AiRequest {
  system: string;
  prompt: string;
  images: AiImage[];
  schema: z.ZodType;
}

export interface AiAdapter {
  /** Returns the model's JSON (unvalidated). */
  json(key: string, model: string, req: AiRequest): Promise<unknown>;
  /** A tiny call that proves the key works with the configured model. */
  test(key: string, model: string): Promise<void>;
}

const name = (p: ProviderId) => PROVIDER_BY_ID[p].name;

function fromStatus(provider: ProviderId, status: number, body: string): AiError {
  const n = name(provider);
  if (status === 401 || (status === 400 && /api[_ ]?key|API_KEY_INVALID|invalid.*key/i.test(body)))
    return new AiError("invalid_key", `Your ${n} key didn't work. Check it in Settings.`);
  if (status === 402 || /insufficient|quota|billing|credit|balance/i.test(body))
    return new AiError("quota", `Your ${n} account is out of credit or over its quota. Check it with ${n}, then try again.`);
  if (status === 403) return new AiError("invalid_key", `Your ${n} key isn't allowed to use this model. Check it in Settings.`);
  if (status === 429) return new AiError("rate_limit", `${n} is busy right now. Try again in a minute.`);
  if (status === 404) return new AiError("unavailable", `${n} doesn't offer the configured model any more. The app's AI settings need updating.`);
  if (status >= 500) return new AiError("unavailable", `${n} isn't answering right now. Try again shortly.`);
  return new AiError("other", `${n} couldn't handle that request (${status}).`);
}

async function post(provider: ProviderId, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_CALL.timeoutMs),
    });
  } catch {
    throw new AiError("network", `Couldn't reach ${name(provider)}. Check your connection and try again.`);
  }
  const text = await res.text();
  if (!res.ok) throw fromStatus(provider, res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("bad_output", `${name(provider)} sent back something unreadable.`);
  }
}

function parseJsonText(provider: ProviderId, text: string | undefined | null): unknown {
  if (!text) throw new AiError("bad_output", `${name(provider)} sent back an empty answer.`);
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    throw new AiError("bad_output", `${name(provider)}'s answer wasn't valid JSON.`);
  }
}

// Claude ------------------------------------------------------------------------------------------

const anthropic: AiAdapter = {
  async json(key, model, req) {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: AI_CALL.timeoutMs });
    try {
      // Haiku 5.5 rejects a non-default temperature, so the low-temperature setting isn't sent here.
      // Low effort keeps this a quick single pass.
      const msg = await client.messages.create({
        model,
        max_tokens: AI_CALL.maxOutputTokens * 2,
        system: req.system,
        output_config: { effort: "low", format: { type: "json_schema", schema: jsonSchema(req.schema) } },
        messages: [
          {
            role: "user",
            content: [
              ...req.images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.mime, data: i.base64 } })),
              { type: "text" as const, text: req.prompt },
            ],
          },
        ],
      });
      if (msg.stop_reason === "refusal") throw new AiError("refused", "Claude declined to read that. Try a different photo.");
      const text = msg.content.find((b) => b.type === "text");
      return parseJsonText("anthropic", text && "text" in text ? text.text : null);
    } catch (e) {
      throw claudeError(e);
    }
  },
  async test(key, model) {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 });
    try {
      await client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with OK." }] });
    } catch (e) {
      throw claudeError(e);
    }
  },
};

function claudeError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new AiError("invalid_key", "Your Claude key didn't work. Check it in Settings.");
  if (e instanceof Anthropic.PermissionDeniedError) return new AiError("invalid_key", "Your Claude key isn't allowed to use this model. Check it in Settings.");
  if (e instanceof Anthropic.RateLimitError) return new AiError("rate_limit", "Claude is busy right now, or your account hit its rate limit. Try again in a minute.");
  if (e instanceof Anthropic.NotFoundError) return new AiError("unavailable", "Claude doesn't offer the configured model any more. The app's AI settings need updating.");
  if (e instanceof Anthropic.APIConnectionError) return new AiError("network", "Couldn't reach Claude. Check your connection and try again.");
  if (e instanceof Anthropic.APIError) return fromStatus("anthropic", e.status ?? 0, e.message);
  return new AiError("other", "Something went wrong talking to Claude.");
}

// Gemini ------------------------------------------------------------------------------------------

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

const gemini: AiAdapter = {
  async json(key, model, req) {
    const res = (await post("gemini", `${GEMINI}/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [
        {
          role: "user",
          parts: [...req.images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.base64 } })), { text: req.prompt }],
        },
      ],
      generationConfig: {
        temperature: AI_CALL.temperature,
        maxOutputTokens: AI_CALL.maxOutputTokens * 2,
        responseMimeType: "application/json",
        responseSchema: geminiSchema(req.schema),
      },
    })) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
    if (res.promptFeedback?.blockReason) throw new AiError("refused", "Gemini declined to read that. Try a different photo.");
    const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    return parseJsonText("gemini", text);
  },
  async test(key, model) {
    await post("gemini", `${GEMINI}/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, {
      contents: [{ role: "user", parts: [{ text: "Reply with OK." }] }],
      generationConfig: { maxOutputTokens: 16 },
    });
  },
};

// DeepSeek ----------------------------------------------------------------------------------------

const DEEPSEEK = "https://api.deepseek.com/chat/completions";

const deepseek: AiAdapter = {
  async json(key, model, req) {
    // DeepSeek's JSON mode needs the schema in the prompt and the word "json" somewhere in it.
    const prompt = `${req.prompt}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(jsonSchema(req.schema))}`;
    const body = {
      model,
      temperature: AI_CALL.temperature,
      max_tokens: AI_CALL.maxOutputTokens * 2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
            { type: "text", text: prompt },
          ],
        },
      ],
    };
    const res = (await post("deepseek", DEEPSEEK, { authorization: `Bearer ${key}` }, body)) as {
      choices?: { message?: { content?: string } }[];
    };
    return parseJsonText("deepseek", res.choices?.[0]?.message?.content);
  },
  async test(key, model) {
    await post("deepseek", DEEPSEEK, { authorization: `Bearer ${key}` }, {
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with OK." }],
    });
  },
};

export const ADAPTERS: Record<ProviderId, AiAdapter> = { anthropic, gemini, deepseek };
