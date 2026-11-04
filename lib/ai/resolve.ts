import "server-only";

// The AI estimate (Q5): a last resort the person asks for when no food matches. The AI estimates
// the values, stored as a private "AI estimate" food and flagged wherever it's totalled.

import type { SupabaseClient } from "@supabase/supabase-js";
import { candidateById, type Candidate } from "../drafts";
import { noEmDash } from "../format";
import { cleanEstimate, sentenceCase } from "../resolution";
import { admin } from "../supabase/admin";
import { AiError } from "./errors";
import { ESTIMATE_SYSTEM, estimatePrompt } from "./prompts";
import { runAi, userAi } from "./run";
import { EstimateSchema } from "./schemas";

/** The phrase as search sees it ("8 oz Flat white (oat milk)" → "flat white oat milk"). */
async function normalisedPhrase(sb: SupabaseClient, phrase: string): Promise<string> {
  const { data } = await sb.rpc("normalise_food_query", { q: phrase });
  return ((data as string[] | null) ?? []).join(" ").slice(0, 200);
}

/** Q5: the person's AI estimates the values. One private food per person and phrase, reused after. */
export async function estimateFood(sb: SupabaseClient, userId: string, phrase: string): Promise<Candidate> {
  const key = (await normalisedPhrase(sb, phrase)) || phrase.toLowerCase().trim().slice(0, 200);
  const sourceId = `${userId}:${key}`;
  const { data: existing } = await admin().from("foods").select("id").eq("source", "ai").eq("source_id", sourceId).maybeSingle();
  if (existing) {
    const c = await candidateById(sb, existing.id);
    if (c) return c;
  }
  const ai = await userAi(userId);
  const r = await runAi(ai, { system: ESTIMATE_SYSTEM, prompt: estimatePrompt(phrase), schema: EstimateSchema });
  const values = cleanEstimate(r);
  if (!values) throw new AiError("bad_output", "The AI couldn't estimate that. Try describing it differently.");
  const name = noEmDash(r.name.trim()) || sentenceCase(phrase.trim());
  const { data: row, error } = await admin()
    .from("foods")
    .upsert(
      {
        source: "ai",
        source_id: sourceId,
        visibility: "private",
        created_by: userId,
        name,
        display_name: name,
        ...values,
        is_liquid: r.is_liquid,
        raw: { phrase, provider: ai.provider, model: ai.model, confidence: r.confidence },
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "source,source_id" },
    )
    .select("id")
    .single();
  if (error || !row) throw new AiError("other", "Couldn't save the estimate. Try again.");
  const c = await candidateById(sb, row.id);
  if (!c) throw new AiError("other", "Couldn't load the estimate. Try again.");
  return c;
}
