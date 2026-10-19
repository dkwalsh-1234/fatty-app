import "server-only";

// Runs one AI call with the signed-in person's own key: decrypt, call, validate, retry once on a
// bad or transient answer, then give up with a clear error. One pass only: no "check your answer".

import type { z } from "zod";
import { admin } from "../supabase/admin";
import { ADAPTERS, type AiImage } from "./adapters";
import { PROVIDER_BY_ID, type ProviderId } from "./config";
import { open } from "./crypto";
import { AiError, NO_KEY_MESSAGE } from "./errors";

export interface UserAi {
  provider: ProviderId;
  model: string;
  key: string;
}

/** The person's provider, model and decrypted key. Server routes only; never sent to the browser. */
export async function userAi(userId: string): Promise<UserAi> {
  const { data } = await admin().from("ai_keys").select("provider, key_encrypted, model").eq("owner_id", userId).maybeSingle();
  if (!data) throw new AiError("no_key", NO_KEY_MESSAGE);
  const key = open(data.key_encrypted);
  if (!key) throw new AiError("invalid_key", "Your saved AI key can't be read any more. Add it again in Settings.");
  const provider = data.provider as ProviderId;
  // The model comes from config so it can be updated in one place; a saved override wins if present.
  return { provider, key, model: data.model || PROVIDER_BY_ID[provider].model };
}

export async function runAi<S extends z.ZodType>(
  ai: UserAi,
  req: { system: string; prompt: string; images?: AiImage[]; schema: S },
): Promise<z.infer<S>> {
  const adapter = ADAPTERS[ai.provider];
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await adapter.json(ai.key, ai.model, { ...req, images: req.images ?? [] });
      const parsed = req.schema.safeParse(raw);
      if (parsed.success) return parsed.data;
      last = new AiError("bad_output", `${PROVIDER_BY_ID[ai.provider].name}'s answer didn't have the expected shape. Try again.`);
    } catch (e) {
      last = e;
      if (!(e instanceof AiError) || !e.transient) break;
    }
  }
  throw last instanceof AiError ? last : new AiError("other", "Something went wrong with the AI call.");
}

/** JSON body for an AI failure. The page shows the message, a Retry button, and a Settings link for key problems. */
export function aiErrorBody(e: unknown) {
  if (e instanceof AiError) return { error: e.message, kind: e.kind, settings: e.settings };
  return { error: "Something went wrong. Try again.", kind: "other", settings: false };
}
