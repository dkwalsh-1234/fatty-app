import { MEAL_SYSTEM, mealPrompt } from "@/lib/ai/prompts";
import { aiErrorBody, runAi, userAi } from "@/lib/ai/run";
import { MealPhotoSchema, type MealPhotoResult } from "@/lib/ai/schemas";
import { bad, json, readJson, routeUser } from "@/lib/api";
import { MEAL_PHOTO_BUCKET } from "@/lib/config";
import { draftFromPhoto, type Draft } from "@/lib/drafts";
import { noEmDash } from "@/lib/format";
import { photoForAi } from "@/lib/photos-server";
import { admin } from "@/lib/supabase/admin";

// Photo + optional hint → the person's own AI provider → items with grams → matched to foods
// → a draft meal. The photo and the AI response are stored, so nothing is ever re-sent to AI.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const body = await readJson<{ photo_path?: string; hint?: string | null }>(req);
  if (!body?.photo_path) return bad("Take a photo first.");
  const hint = body.hint?.trim().slice(0, 300) || null;

  // Already processed? Reuse the stored answer.
  const { data: seen } = await auth.sb.from("meal_photos").select("id, ai_response, hint").eq("storage_path", body.photo_path).maybeSingle();
  if (seen?.ai_response?.draft) return json({ draft: seen.ai_response.draft as Draft });

  let ai;
  try {
    ai = await userAi(auth.user.id);
  } catch (e) {
    return json(aiErrorBody(e), 400);
  }
  let result: MealPhotoResult;
  try {
    const image = await photoForAi(MEAL_PHOTO_BUCKET, body.photo_path, auth.user.id);
    result = await runAi(ai, { system: MEAL_SYSTEM, prompt: mealPrompt(hint), images: [image], schema: MealPhotoSchema });
  } catch (e) {
    if (e instanceof Error && !("kind" in e)) return bad(e.message, 400);
    return json(aiErrorBody(e), 502);
  }
  result = { items: result.items.map((i) => ({ ...i, name: noEmDash(i.name), display_name: noEmDash(i.display_name) })) };
  if (!result.items.length) return bad("No food found in that photo. Try again closer up, or type it instead.", 422);

  const items = await draftFromPhoto(auth.sb, result);
  const { data: row, error } = await admin()
    .from("meal_photos")
    .insert({ owner_id: auth.user.id, storage_path: body.photo_path, hint, provider: ai.provider, model: ai.model, ai_response: { ai: result } })
    .select("id")
    .single();
  if (error) return bad("Couldn't save the photo record. Try again.", 500);
  const draft: Draft = { kind: "photo", meal_photo_id: row.id, hint, items };
  await admin().from("meal_photos").update({ ai_response: { ai: result, draft } }).eq("id", row.id);
  return json({ draft });
}
