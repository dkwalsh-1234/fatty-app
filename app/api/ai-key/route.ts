import { z } from "zod";
import { ADAPTERS } from "@/lib/ai/adapters";
import { PROVIDER_BY_ID } from "@/lib/ai/config";
import { seal } from "@/lib/ai/crypto";
import { AiError } from "@/lib/ai/errors";
import { bad, json, readJson, routeUser } from "@/lib/api";
import { admin } from "@/lib/supabase/admin";

const Body = z.object({
  provider: z.enum(["anthropic", "deepseek", "gemini"]),
  key: z.string().trim().min(10).max(400),
  /** false = Test key only; true = test, then encrypt and save. */
  save: z.boolean(),
});

// Test, encrypt and save the person's key. Returns only provider, model and the last four
// characters: the key itself never goes back to the browser.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return bad("Choose a provider and paste a key.");
  const { provider, key, save } = parsed.data;
  const cfg = PROVIDER_BY_ID[provider];
  if (!cfg.keyHint.test(key)) return json({ ok: false, error: `That doesn't look like a ${cfg.name} API key.` }, 400);
  try {
    await ADAPTERS[provider].test(key, cfg.model);
  } catch (e) {
    return json({ ok: false, error: e instanceof AiError ? e.message : `${cfg.name} didn't accept that key.` }, 400);
  }
  if (!save) return json({ ok: true, provider, model: cfg.model, last4: key.slice(-4) });
  const { error } = await admin()
    .from("ai_keys")
    .upsert({
      owner_id: auth.user.id,
      provider,
      key_encrypted: seal(key),
      key_last4: key.slice(-4),
      model: null,
      verified_at: new Date().toISOString(),
    });
  if (error) return json({ ok: false, error: "Couldn't save the key. Try again." }, 500);
  return json({ ok: true, provider, model: cfg.model, last4: key.slice(-4) });
}

export async function DELETE() {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const { error } = await admin().from("ai_keys").delete().eq("owner_id", auth.user.id);
  if (error) return bad("Couldn't delete the key.", 500);
  return json({ ok: true });
}
