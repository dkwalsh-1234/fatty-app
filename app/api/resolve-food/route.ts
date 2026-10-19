import { resolvePhrase, splitItems } from "@/lib/ai/resolve";
import { aiErrorBody, userAi } from "@/lib/ai/run";
import { bad, json, readJson, routeUser } from "@/lib/api";

// Search's "Ask AI to find this" (item 4): only on that tap, never on type-ahead. The AI rewords
// the phrase into database terms or splits it into parts; matches still come from our own foods.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const body = await readJson<{ phrase?: string; grams?: number | null }>(req);
  const phrase = body?.phrase?.trim().slice(0, 200);
  if (!phrase) return bad("Type a food first.");
  const grams = typeof body?.grams === "number" && body.grams > 0 && body.grams < 5000 ? body.grams : null;
  try {
    const { resolution, cached } = await resolvePhrase(auth.sb, () => userAi(auth.user.id), auth.user.id, phrase, grams);
    // A split goes to meal confirm as rows, like a typed meal.
    const items = resolution.kind === "split" ? splitItems(resolution.components, { label: phrase }) : undefined;
    return json({ resolution, items, cached });
  } catch (e) {
    const body = aiErrorBody(e);
    return json(body, body.kind === "no_key" ? 400 : 502);
  }
}
