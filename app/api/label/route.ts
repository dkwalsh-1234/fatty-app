import { LABEL_SYSTEM, labelPrompt } from "@/lib/ai/prompts";
import { aiErrorBody, runAi, userAi } from "@/lib/ai/run";
import { LabelSchema } from "@/lib/ai/schemas";
import { bad, json, readJson, routeUser } from "@/lib/api";
import { normalizeBarcode } from "@/lib/barcode";
import { LABEL_PHOTO_BUCKET } from "@/lib/config";
import { photoForAi } from "@/lib/photos-server";
import { admin } from "@/lib/supabase/admin";

// Photo in Storage → the person's own AI provider → draft per-100 g values.
// Saves nothing in the catalogue until they confirm (see ./confirm).
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const body = await readJson<{ photo_path?: string; front_path?: string | null; barcode?: string | null }>(req);
  if (!body?.photo_path) return bad("Take a photo of the nutrition panel first.");
  const barcode = body.barcode ? normalizeBarcode(body.barcode) : null;

  // A label is only ever read once across all users: check the catalogue by barcode first.
  if (barcode) {
    const { data: known } = await auth.sb
      .from("foods")
      .select("*")
      .eq("barcode", barcode)
      .eq("visibility", "shared")
      .not("energy_kj", "is", null)
      .limit(1);
    if (known?.[0]) return json({ existing: known[0] });
  }

  let ai;
  try {
    ai = await userAi(auth.user.id);
  } catch (e) {
    return json(aiErrorBody(e), 400);
  }
  try {
    const images = [await photoForAi(LABEL_PHOTO_BUCKET, body.photo_path, auth.user.id)];
    if (body.front_path) images.push(await photoForAi(LABEL_PHOTO_BUCKET, body.front_path, auth.user.id));
    const result = await runAi(ai, { system: LABEL_SYSTEM, prompt: labelPrompt({ hasFront: images.length > 1 }), images, schema: LabelSchema });
    const { data: row, error } = await admin()
      .from("label_photos")
      .insert({
        owner_id: auth.user.id,
        storage_path: body.photo_path,
        front_storage_path: body.front_path ?? null,
        barcode,
        provider: ai.provider,
        model: ai.model,
        ai_response: result,
      })
      .select("id")
      .single();
    if (error) return bad("Couldn't save the photo record. Try again.", 500);
    return json({ label_photo_id: row.id, draft: result, provider: ai.provider });
  } catch (e) {
    if (e instanceof Error && !("kind" in e)) return bad(e.message, 400);
    return json(aiErrorBody(e), 502);
  }
}
