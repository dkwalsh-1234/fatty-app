import "server-only";

// The AI fallbacks behind search. resolvePhrase (item 4): when search finds nothing useful, the
// person's AI rewords the phrase into database terms, or splits a mixed drink or dish into parts,
// and every suggestion runs through the same search. Values still come only from `foods`. Answers
// are cached for everyone by normalised phrase, so the same phrase never costs a second AI call.
// estimateFood (Q5): a last resort the person asks for. The AI estimates the values, stored as a
// private "AI estimate" food and flagged wherever it's totalled.

import type { SupabaseClient } from "@supabase/supabase-js";
import { candidateById, matchFoods, newKey, type Candidate, type DraftItem } from "../drafts";
import { noEmDash } from "../format";
import { cleanEstimate, cleanResolve, componentsForGrams, isWeakMatch, sentenceCase, type Resolution } from "../resolution";
import { admin } from "../supabase/admin";
import { AiError } from "./errors";
import { ESTIMATE_SYSTEM, estimatePrompt, RESOLVE_SYSTEM, resolvePrompt } from "./prompts";
import { runAi, userAi, type UserAi } from "./run";
import { EstimateSchema, ResolveSchema, type ResolveResult } from "./schemas";

type AiSource = UserAi | (() => Promise<UserAi>);
const everyWord = (m: { candidates: Candidate[]; tier: number | null }) => m.candidates.length > 0 && m.tier === 1;
const FILLER = new Set(["with", "and", "a", "an", "of", "the", "in", "on"]);
/** Words search requires for a phrasing (roughly what normalise_food_query keeps). */
const keyWords = (p: string) => p.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w)).length;
const getAi = (ai: AiSource) => (typeof ai === "function" ? ai() : Promise.resolve(ai));

/** The cache key: the phrase as search sees it ("8 oz Flat white (oat milk)" → "flat white oat milk"). */
export async function normalisedPhrase(sb: SupabaseClient, phrase: string): Promise<string> {
  const { data } = await sb.rpc("normalise_food_query", { q: phrase });
  return ((data as string[] | null) ?? []).join(" ").slice(0, 200);
}

/** The AI's database terms for a phrase: from the shared cache, else one AI call, then cached. */
async function translate(sb: SupabaseClient, ai: AiSource, userId: string, key: string, phrase: string, grams: number | null) {
  const { data: seen } = await sb.from("query_resolutions").select("response_json").eq("normalised_phrase", key).maybeSingle();
  if (seen) return { result: cleanResolve(seen.response_json as ResolveResult), cached: true };
  const who = await getAi(ai);
  const raw = await runAi(who, { system: RESOLVE_SYSTEM, prompt: resolvePrompt(phrase, grams), schema: ResolveSchema });
  const result = cleanResolve({
    phrasings: raw.phrasings.map(noEmDash),
    components: raw.components.map((c) => ({ ...c, name: noEmDash(c.name) })),
  });
  await admin()
    .from("query_resolutions")
    .upsert(
      { normalised_phrase: key, response_json: result, provider: who.provider, model: who.model, created_by: userId },
      { onConflict: "normalised_phrase", ignoreDuplicates: true },
    );
  return { result, cached: false };
}

export async function resolvePhrase(
  sb: SupabaseClient,
  ai: AiSource,
  userId: string,
  phrase: string,
  grams: number | null,
): Promise<{ resolution: Resolution; cached: boolean }> {
  const key = await normalisedPhrase(sb, phrase);
  if (!key) return { resolution: { kind: "none" }, cached: true };
  const { result, cached } = await translate(sb, ai, userId, key, phrase, grams);

  // Only a phrasing whose every word matches counts. Matching any one of the AI's words is too
  // loose: "milk, full cream, heated" found "Corn, canned, creamed, heated".
  // A food that matches a longer phrasing in full is the more specific match, so it comes first:
  // "soup broth with meat and noodles" beats "beef noodle soup" (which found laksa).
  const found = await Promise.all(result.phrasings.map(async (p) => ({ m: await matchFoods(sb, p), words: keyWords(p) })));
  const best = new Map<string, { c: Candidate; words: number; order: number }>();
  let order = 0;
  for (const { m, words } of found) {
    if (!everyWord(m)) continue;
    for (const c of m.candidates) {
      const seen = best.get(c.id);
      if (!seen || words > seen.words) best.set(c.id, { c, words, order: seen?.order ?? order });
      order++;
    }
  }
  const candidates = [...best.values()].sort((a, b) => b.words - a.words || a.order - b.order).map((x) => x.c);
  if (candidates.length) return { resolution: { kind: "match", candidates: candidates.slice(0, 3) }, cached };

  const parts = componentsForGrams(result.components, grams);
  if (parts.length) {
    const components = await Promise.all(
      parts.map(async (c) => {
        const m = await matchFoods(sb, c.name);
        return { ...c, candidates: everyWord(m) ? m.candidates : [] };
      }),
    );
    if (components.some((c) => c.candidates.length)) return { resolution: { kind: "split", components }, cached };
  }
  return { resolution: { kind: "none" }, cached };
}

/** A split as meal confirm rows: ticked, estimated grams, each saying what it was split from. */
export function splitItems(components: Extract<Resolution, { kind: "split" }>["components"], from: DraftItem | { label: string; confidence?: DraftItem["confidence"] }): DraftItem[] {
  return components.map((c) => ({
    key: newKey(),
    label: sentenceCase(c.name),
    query: c.name,
    grams: c.grams,
    estimate: true,
    confidence: from.confidence ?? null,
    suggested: false,
    note: null,
    candidates: c.candidates,
    tier: c.candidates.length ? 1 : null,
    splitFrom: from.label,
  }));
}

/**
 * Photo and typed meals: every item search couldn't match goes through the AI fallback, if the
 * person has a key. Failures never block the meal; the item just stays under "Needs a food".
 */
export async function resolveWeakItems(sb: SupabaseClient, userId: string, items: DraftItem[], ai?: UserAi): Promise<DraftItem[]> {
  const weak = new Set(items.filter((i) => !i.suggested && isWeakMatch(i.candidates.length, i.tier)).map((i) => i.key));
  if (!weak.size) return items;
  let loaded: Promise<UserAi> | null = ai ? Promise.resolve(ai) : null;
  const lazyAi = () => (loaded ??= userAi(userId));
  const out = await Promise.all(
    items.map(async (i): Promise<DraftItem[]> => {
      if (!weak.has(i.key)) return [i];
      try {
        const { resolution } = await resolvePhrase(sb, lazyAi, userId, i.query, i.grams);
        if (resolution.kind === "match") return [{ ...i, candidates: resolution.candidates, tier: 1, note: i.note ? `${i.note} · matched by AI` : "matched by AI" }];
        if (resolution.kind === "split") return splitItems(resolution.components, i);
      } catch {
        // No key, or the AI failed: leave the item for the person to search.
      }
      return [i];
    }),
  );
  return out.flat();
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
