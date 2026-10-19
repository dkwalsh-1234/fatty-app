import { estimateFood } from "@/lib/ai/resolve";
import { aiErrorBody } from "@/lib/ai/run";
import { bad, json, readJson, routeUser } from "@/lib/api";

// "Use an AI estimate" (Q5): a last resort the person taps when no food matches. The values come
// from their AI provider, are saved as a private "AI estimate" food, and are flagged in totals.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const body = await readJson<{ phrase?: string }>(req);
  const phrase = body?.phrase?.trim().slice(0, 200);
  if (!phrase || phrase.length < 2) return bad("Type a food first.");
  try {
    return json({ candidate: await estimateFood(auth.sb, auth.user.id, phrase) });
  } catch (e) {
    const body = aiErrorBody(e);
    return json(body, body.kind === "no_key" ? 400 : 502);
  }
}
