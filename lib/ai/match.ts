import "server-only";

// AI-first matching for typed and photographed meals. Search alone judges badly: it found eggs
// benedict for "poached eggs" and toasted muesli for "sourdough toast". So the AI judges:
// 1. the first pass (typed text, or a photo) lists the foods with amounts and writes searches in
//    the database's own terms;
// 2. the app runs those searches and lists what they found, each food with its measures;
// 3. the pick pass chooses the matching food and amount from that list, or none.
// Values still come only from `foods`: the AI never returns a nutrient.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CANDIDATE_COLS, newKey, toCandidate, type DraftItem } from "../drafts";
import { applyPick, describeItems, pickMeasures, searchesFor, type PoolFood, type Understood, type UnitFoodRow } from "../matching";
import type { Measure } from "../types";
import { PICK_SYSTEM, pickPrompt } from "./prompts";
import { runAi, type UserAi } from "./run";
import { PickSchema, type PickResult } from "./schemas";

const PER_SEARCH = 8;
const PER_ITEM = 14;

interface Hit {
  id: string;
  use_count: number | null;
  last_grams: number | null;
}

/** What each item's searches found, merged in order: the first search's best first. */
async function findFoods(sb: SupabaseClient, items: Understood[]): Promise<Hit[][]> {
  return Promise.all(
    items.map(async (u) => {
      const found = await Promise.all(
        searchesFor(u).map(async (q) => ((await sb.rpc("search_foods", { q, lim: PER_SEARCH })).data as Hit[] | null) ?? []),
      );
      const out = new Map<string, Hit>();
      // Round-robin, so every search's best few make the list before any one search's tail.
      for (let i = 0; i < PER_SEARCH && out.size < PER_ITEM; i++) {
        for (const hits of found) if (hits[i] && !out.has(hits[i].id) && out.size < PER_ITEM) out.set(hits[i].id, hits[i]);
      }
      return [...out.values()];
    }),
  );
}

/** The foods and their measures, in one query each for the whole meal. */
async function pools(sb: SupabaseClient, hits: Hit[][]): Promise<PoolFood[][]> {
  const ids = [...new Set(hits.flat().map((h) => h.id))];
  if (!ids.length) return hits.map(() => []);
  const [{ data: foods }, { data: measures }] = await Promise.all([
    sb.from("foods").select(`${CANDIDATE_COLS}, pack_g, total_weight_g, serves`).in("id", ids),
    sb.from("food_measures").select("id, food_id, label, grams, source, owner_id, rank").in("food_id", ids),
  ]);
  const byId = new Map((foods ?? []).map((f) => [f.id as string, f as Record<string, unknown>]));
  const measuresOf = new Map<string, Measure[]>();
  for (const m of (measures ?? []) as Measure[]) measuresOf.set(m.food_id, [...(measuresOf.get(m.food_id) ?? []), { ...m, grams: Number(m.grams) }]);
  return hits.map((list) =>
    list.flatMap((h) => {
      const f = byId.get(h.id);
      if (!f) return [];
      const candidate = toCandidate(f, h.last_grams);
      const unitFood: UnitFoodRow = {
        name: candidate.name,
        display_name: candidate.display_name,
        source: candidate.source as UnitFoodRow["source"],
        is_liquid: candidate.is_liquid,
        density_g_per_ml: candidate.density_g_per_ml,
        serving_g: candidate.serving_g,
        pack_g: f.pack_g == null ? null : Number(f.pack_g),
        total_weight_g: f.total_weight_g == null ? null : Number(f.total_weight_g),
        serves: f.serves == null ? null : Number(f.serves),
      };
      return [{ candidate, measures: pickMeasures(unitFood, measuresOf.get(h.id) ?? []), logged: h.use_count ?? 0 }];
    }),
  );
}

/**
 * Meal confirm rows for what the first pass understood. `context` says where it came from
 * ("They wrote: …", or a photo and its hint). One AI call for the whole meal; throws an AiError
 * when it fails, so the person can retry rather than get search's guess.
 */
export async function pickFoods(sb: SupabaseClient, ai: UserAi, items: Understood[], context: string): Promise<DraftItem[]> {
  if (!items.length) return [];
  const found = await pools(sb, await findFoods(sb, items));
  let picks: PickResult["items"] = [];
  if (found.some((p) => p.length)) {
    const result = await runAi(ai, { system: PICK_SYSTEM, prompt: pickPrompt(context, describeItems(items, found)), schema: PickSchema });
    picks = result.items;
  }
  return items.map((u, n) => applyPick(u, found[n], picks.find((p) => p.item === n + 1), newKey()));
}
