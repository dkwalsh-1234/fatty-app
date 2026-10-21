import { z } from "zod";
import { bad, json, readJson, routeUser } from "@/lib/api";
import { normalizeBarcode } from "@/lib/barcode";
import { noEmDash } from "@/lib/format";
import { NUTRIENT_KEYS } from "@/lib/nutrients";
import { admin } from "@/lib/supabase/admin";

const v = z.number().min(0).max(100_000).nullable();
const Body = z.object({
  mode: z.enum(["new", "fill", "correct"]),
  /** For "fill": the shared food whose missing values the label fills. For "correct": the food the label corrects. */
  food_id: z.string().uuid().optional(),
  label_photo_id: z.string().uuid().nullable().optional(),
  photo_path: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  serving_g: z.number().positive().max(100_000).nullable(),
  pack_g: z.number().positive().max(1_000_000).nullable(),
  is_liquid: z.boolean(),
  values: z.object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, v])) as Record<(typeof NUTRIENT_KEYS)[number], typeof v>),
});

// The person has checked the values. Every food created from a label, read by AI or typed in,
// goes into the shared catalogue with the photo and who added it. One label row per barcode: if
// someone added it first, theirs is kept and returned instead.
//
// "correct" ("Numbers wrong? Photograph the label"): the label row replaces the food it corrects
// (an Open Food Facts product, your own food or an AI estimate). The old row stays, because entries
// point at it, but it's marked superseded: search skips it, the amount sheet and barcode lookup use
// the label row. Returns how many of your entries were logged from the old values, so the app can
// offer to update them.
export async function POST(req: Request) {
  const auth = await routeUser();
  if ("error" in auth) return auth.error;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return bad("Some values don't look right. Check the form.");
  const b = parsed.data;
  const svc = admin();
  if (b.mode === "correct") return correct(auth, b);
  if (b.values.energy_kj == null && b.mode === "new") return bad("Energy is needed. Type it from the label.");
  const barcode = b.barcode ? normalizeBarcode(b.barcode) : null;

  if (b.mode === "fill") {
    if (!b.food_id) return bad("Which food?");
    const { data: food } = await auth.sb.from("foods").select("*").eq("id", b.food_id).maybeSingle();
    if (!food) return bad("Couldn't find that food.", 404);
    // Only gaps are filled; values already there are never overwritten.
    const patch: Record<string, number> = {};
    for (const k of NUTRIENT_KEYS) if (food[k] == null && b.values[k] != null) patch[k] = b.values[k] as number;
    if (food.visibility === "private") {
      if (food.created_by !== auth.user.id) return bad("That isn't your food.", 403);
      const { data, error } = await auth.sb.from("foods").update(patch).eq("id", food.id).select("*").single();
      if (error) return bad("Couldn't save.", 500);
      return json({ food: data, filled: Object.keys(patch) });
    }
    const { data, error } = await svc.from("foods").update(patch).eq("id", food.id).select("*").single();
    if (error) return bad("Couldn't save.", 500);
    if (b.label_photo_id) await svc.from("label_photos").update({ food_id: food.id }).eq("id", b.label_photo_id).eq("owner_id", auth.user.id);
    return json({ food: data, filled: Object.keys(patch) });
  }

  if (barcode) {
    const { data: first } = await svc.from("foods").select("*").eq("barcode", barcode).eq("visibility", "shared").in("source", ["label", "off"]).not("energy_kj", "is", null).limit(1);
    if (first?.[0]) return json({ food: first[0], existing: true });
  }

  const added = await addLabelFood(auth.user.id, b, barcode, null);
  if ("error" in added) return added.error;
  return json(added.existing ? { food: added.food, existing: true } : { food: added.food });
}

type Auth = Exclude<Awaited<ReturnType<typeof routeUser>>, { error: unknown }>;
type Confirm = z.infer<typeof Body>;

/** A new shared label food, with its photo and serve size. Someone else's for the same barcode wins. */
async function addLabelFood(userId: string, b: Confirm, barcode: string | null, corrects: string | null) {
  const svc = admin();
  const name = noEmDash(b.name);
  const row = {
    source: "label",
    source_id: null,
    visibility: "shared",
    created_by: userId,
    barcode,
    name,
    display_name: name,
    brand: b.brand ? noEmDash(b.brand) : null,
    serving_g: b.serving_g,
    pack_g: b.pack_g,
    is_liquid: b.is_liquid,
    density_g_per_ml: null,
    ...b.values,
    raw: { label_photo_id: b.label_photo_id ?? null, photo_path: b.photo_path ?? null, ...(corrects ? { corrects } : {}) },
  };
  const { data: food, error } = await svc.from("foods").insert(row).select("*").single();
  if (error) {
    if (barcode && /duplicate key/i.test(error.message)) {
      const { data: existing } = await svc.from("foods").select("*").eq("barcode", barcode).eq("visibility", "shared").eq("source", "label").limit(1);
      if (existing?.[0]) return { food: existing[0], existing: true } as const;
    }
    return { error: bad("Couldn't add it to the catalogue. Try again.", 500) } as const;
  }
  if (b.label_photo_id) {
    await svc.from("label_photos").update({ food_id: food.id }).eq("id", b.label_photo_id).eq("owner_id", userId);
  } else if (b.photo_path && b.photo_path.split("/")[0] === userId) {
    // Typed in by hand with a photo as evidence.
    await svc.from("label_photos").insert({ owner_id: userId, food_id: food.id, storage_path: b.photo_path, barcode });
  }
  if (b.serving_g) {
    await svc.from("food_measures").insert({ food_id: food.id, label: "1 serve", grams: b.serving_g, source: "pack", rank: 0, source_key: `label:${food.id}:serve` });
  }
  return { food, existing: false } as const;
}

async function correct(auth: Auth, b: Confirm) {
  if (!b.food_id) return bad("Which food?");
  const svc = admin();
  const { data: old } = await auth.sb.from("foods").select("*").eq("id", b.food_id).maybeSingle();
  if (!old) return bad("Couldn't find that food.", 404);
  if (old.source === "label" || old.source === "meal") return bad("That food is already from a label.");
  if (old.visibility === "private" && old.created_by !== auth.user.id) return bad("That isn't your food.", 403);
  const barcode = old.barcode ?? (b.barcode ? normalizeBarcode(b.barcode) : null);

  // Someone already corrected this product from its label: theirs is used.
  const { data: theirs } = barcode
    ? await svc.from("foods").select("*").eq("barcode", barcode).eq("visibility", "shared").eq("source", "label").limit(1)
    : { data: null };
  let fixed: Record<string, unknown>;
  let existing: boolean;
  if (theirs?.[0]) {
    fixed = theirs[0];
    existing = true;
  } else {
    if (b.values.energy_kj == null) return bad("Energy is needed. Type it from the label.");
    const added = await addLabelFood(auth.user.id, b, barcode, old.id);
    if ("error" in added) return added.error;
    fixed = added.food;
    existing = added.existing;
  }
  if (fixed.id !== old.id) await svc.from("foods").update({ superseded_by: fixed.id }).eq("id", old.id);
  const { count } = await auth.sb.from("log_entries").select("id", { count: "exact", head: true }).eq("food_id", old.id);
  return json({ food: fixed, existing, replaced: old.id, entries: count ?? 0 });
}
