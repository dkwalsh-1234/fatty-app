import { createHash } from "node:crypto";
import { pickFoods } from "@/lib/ai/match";
import { TEXT_SYSTEM, textPrompt } from "@/lib/ai/prompts";
import { aiErrorBody, runAi, userAi, type UserAi } from "@/lib/ai/run";
import { TextParseSchema } from "@/lib/ai/schemas";
import { bad, json, readJson, routeUser } from "@/lib/api";
import { tryLocalText, type Draft, type DraftItem } from "@/lib/drafts";
import { fromText } from "@/lib/matching";
import { admin } from "@/lib/supabase/admin";

/** Bump when the prompts or matching change, so old answers are worked out again. */
const VERSION = 3;

// Typed or dictated text (from Type, or Search's "Let AI pick") → the person's own AI lists the
// foods with amounts and database searches → the app runs them → the AI picks the matching food
// and amount from what they found → a draft meal to check. Without a key, a plain list with an
// amount and an obvious match for every item still works through search alone.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const body = await readJson<{ text?: string }>(req);
  const text = body?.text?.trim().slice(0, 1000);
  if (!text) return bad("Type what you ate first.");

  // Already worked out this exact text? Reuse it; never call AI twice for the same thing.
  const hash = createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ")).digest("hex");
  const { data: seen } = await auth.sb.from("text_parses").select("id, ai_response").eq("input_hash", hash).maybeSingle();
  const cached = seen?.ai_response as { v?: number; items?: DraftItem[] } | undefined;
  if (seen && cached?.v === VERSION && cached.items?.length) {
    return json({ draft: { kind: "text", text, text_parse_id: seen.id, items: cached.items } satisfies Draft, ai: true });
  }

  let ai: UserAi;
  try {
    ai = await userAi(auth.user.id);
  } catch (e) {
    const local = await tryLocalText(auth.sb, text);
    if (local) return json({ draft: { kind: "text", text, items: local } satisfies Draft, ai: false });
    return json(aiErrorBody(e), 400);
  }

  let items: DraftItem[];
  try {
    const parsed = await runAi(ai, { system: TEXT_SYSTEM, prompt: textPrompt(text), schema: TextParseSchema, quick: true });
    if (!parsed.items.length) return bad("Couldn't find any foods in that. Try naming each one.", 422);
    items = await pickFoods(auth.sb, ai, parsed.items.map(fromText), `They wrote: "${text}"`);
    const { data: row } = await admin()
      .from("text_parses")
      .upsert(
        { owner_id: auth.user.id, input_hash: hash, input: text, provider: ai.provider, model: ai.model, ai_response: { v: VERSION, parsed, items } },
        { onConflict: "owner_id,input_hash" },
      )
      .select("id")
      .single();
    return json({ draft: { kind: "text", text, text_parse_id: row?.id, items } satisfies Draft, ai: true });
  } catch (e) {
    return json(aiErrorBody(e), 502);
  }
}
