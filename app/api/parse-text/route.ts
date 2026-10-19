import { createHash } from "node:crypto";
import { TEXT_SYSTEM, textPrompt } from "@/lib/ai/prompts";
import { resolveWeakItems } from "@/lib/ai/resolve";
import { aiErrorBody, runAi, userAi, type UserAi } from "@/lib/ai/run";
import { TextParseSchema, type TextParseResult } from "@/lib/ai/schemas";
import { bad, json, readJson, routeUser } from "@/lib/api";
import { draftFromText, tryLocalText, type Draft } from "@/lib/drafts";
import { noEmDash } from "@/lib/format";
import { admin } from "@/lib/supabase/admin";

// Typed or dictated text → a local parse when every item has an amount and an obvious match,
// otherwise the person's own AI provider → items with grams → matched to foods → a draft meal.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const body = await readJson<{ text?: string }>(req);
  const text = body?.text?.trim().slice(0, 1000);
  if (!text) return bad("Type what you ate first.");

  const local = await tryLocalText(auth.sb, text);
  if (local) return json({ draft: { kind: "text", text, items: local } satisfies Draft, ai: false });

  // Already parsed this exact text? Reuse it; never call AI twice for the same thing.
  const hash = createHash("sha256").update(text.toLowerCase().replace(/\s+/g, " ")).digest("hex");
  const { data: seen } = await auth.sb.from("text_parses").select("id, ai_response").eq("input_hash", hash).maybeSingle();
  let result: TextParseResult;
  let id: string | undefined = seen?.id;
  let ai: UserAi | undefined;
  if (seen) {
    result = seen.ai_response as TextParseResult;
  } else {
    try {
      ai = await userAi(auth.user.id);
    } catch (e) {
      return json(aiErrorBody(e), 400);
    }
    try {
      result = await runAi(ai, { system: TEXT_SYSTEM, prompt: textPrompt(text), schema: TextParseSchema });
    } catch (e) {
      return json(aiErrorBody(e), 502);
    }
    result = { items: result.items.map((i) => ({ ...i, text: noEmDash(i.text), display_name: noEmDash(i.display_name) })) };
    const { data: row } = await admin()
      .from("text_parses")
      .insert({ owner_id: auth.user.id, input_hash: hash, input: text, provider: ai.provider, model: ai.model, ai_response: result })
      .select("id")
      .single();
    id = row?.id;
  }
  if (!result.items.length) return bad("Couldn't find any foods in that. Try listing them with commas.", 422);
  // Items search can't match go through the AI fallback (cached by phrase, so a repeat costs nothing).
  const items = await resolveWeakItems(auth.sb, auth.user.id, await draftFromText(auth.sb, result.items), ai);
  return json({ draft: { kind: "text", text, text_parse_id: id, items } satisfies Draft, ai: true });
}
