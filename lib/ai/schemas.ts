// JSON shapes the AI must return. One set for every provider, so results look identical
// whichever key someone uses. The AI never returns nutrient values for meals, text or search;
// EstimateSchema is the one exception, a last resort the person asks for, stored as "AI estimate".

import { z } from 'zod';

const n = z.number().nullable();

export const LabelSchema = z.object({
  product_name: z.string().nullable().describe('Product name if visible, else null'),
  brand: z.string().nullable().describe('Brand if visible, else null'),
  basis: z.enum(['per_100g', 'per_100ml']).nullable().describe('Whether the per-100 column is per 100 g or per 100 mL'),
  per_100: z
    .object({
      energy_kj: n.describe('Energy in kJ per 100, exactly as printed; null if missing or unreadable'),
      energy_kcal_only: n.describe('Only if the panel prints energy in kcal/Cal and not kJ: that number; else null'),
      protein_g: n,
      fat_g: n.describe('Fat, total'),
      sat_fat_g: n.describe('Saturated fat'),
      trans_fat_g: n.describe('Trans fat'),
      carbs_g: n.describe('Carbohydrate (total carbohydrate as printed on an Australian panel)'),
      sugars_g: n,
      fibre_g: n.describe('Dietary fibre'),
      sodium_mg: n.describe('Sodium in mg'),
    })
    .describe('The per-100 column; every value null when missing or unreadable'),
  serving_size: n.describe('Serving size number'),
  serving_unit: z.enum(['g', 'ml']).nullable(),
  servings_per_pack: n,
  derived_from_per_serve: z.boolean().describe('True if per-100 values had to be worked out from the per-serve column'),
});
export type LabelResult = z.infer<typeof LabelSchema>;

export const MealPhotoSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().describe('Plain generic name that would match an Australian food database, e.g. "rice, white, cooked"'),
      display_name: z.string().describe('Short display name, e.g. "White rice"'),
      grams: z.number().describe('Estimated grams of the portion actually visible on the plate'),
      confidence: z.enum(['low', 'medium', 'high']),
      suggested: z.boolean().describe('True only for likely hidden fats (cooking oil, butter, dressing) not named in the hint'),
    }),
  ),
});
export type MealPhotoResult = z.infer<typeof MealPhotoSchema>;

export const TextParseSchema = z.object({
  items: z.array(
    z.object({
      text: z.string().describe('The food words only, e.g. "salad", "eggs", "flat white"'),
      display_name: z.string().describe('Short display name'),
      amount: n.describe('Grams or millilitres if given, else null'),
      unit: z.enum(['g', 'ml']).nullable(),
      count: n.describe('A count if given instead of a weight ("2 eggs" → 2), else null'),
      count_noun: z.string().nullable().describe('The counted noun ("egg"), else null'),
      typical_grams: n.describe('Only when no amount and no count is given: a typical single serve in grams; else null'),
    }),
  ),
});
export type TextParseResult = z.infer<typeof TextParseSchema>;

export const ResolveSchema = z.object({
  phrasings: z
    .array(z.string())
    .describe('One to three generic ways an Australian food database would name this food, most likely first, e.g. "coffee, flat white, plant based milk"'),
  components: z
    .array(
      z.object({
        name: z.string().describe('Generic database name of one part, e.g. "coffee, espresso"'),
        grams: z.number().describe('Grams of this part in the whole amount'),
      }),
    )
    .describe('Only for a mixed drink or dish a database is unlikely to list as one food: its main parts with grams. Otherwise empty.'),
});
export type ResolveResult = z.infer<typeof ResolveSchema>;

export const EstimateSchema = z.object({
  name: z.string().describe('Short generic name for what was estimated, e.g. "Flat white, oat milk"'),
  per_100g: z
    .object({
      energy_kj: z.number().describe('Energy in kJ per 100 g'),
      protein_g: n,
      fat_g: n.describe('Fat, total'),
      sat_fat_g: n.describe('Saturated fat'),
      trans_fat_g: n.describe('Trans fat'),
      carbs_g: n.describe('Carbohydrate, total as on an Australian label'),
      sugars_g: n,
      fibre_g: n.describe('Dietary fibre'),
      sodium_mg: n.describe('Sodium in mg'),
    })
    .describe('Typical values per 100 g as eaten; null where a value cannot reasonably be estimated'),
  is_liquid: z.boolean().describe('True for drinks and other foods measured in mL'),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type EstimateResult = z.infer<typeof EstimateSchema>;

type JsonSchema = Record<string, unknown>;

/** Plain JSON Schema (Claude structured outputs, DeepSeek prompt). */
export function jsonSchema(schema: z.ZodType): JsonSchema {
  const s = z.toJSONSchema(schema) as JsonSchema;
  delete s.$schema;
  return s;
}

/** Gemini's responseSchema uses an OpenAPI subset: nullable instead of anyOf-with-null, no additionalProperties. */
export function geminiSchema(schema: z.ZodType): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const o = { ...(node as JsonSchema) };
    delete o.$schema;
    delete o.additionalProperties;
    if (Array.isArray(o.anyOf)) {
      const parts = o.anyOf as JsonSchema[];
      const nonNull = parts.filter((p) => p.type !== 'null');
      if (nonNull.length === 1 && parts.length === 2) {
        const merged = { ...(walk(nonNull[0]) as JsonSchema), nullable: true } as JsonSchema;
        if (o.description) merged.description = o.description;
        return merged;
      }
    }
    if (Array.isArray(o.type)) {
      const types = (o.type as string[]).filter((t) => t !== 'null');
      if (types.length === 1) {
        o.type = types[0];
        o.nullable = true;
      }
    }
    for (const k of Object.keys(o)) if (typeof o[k] === 'object') o[k] = walk(o[k]);
    return o;
  };
  return walk(jsonSchema(schema)) as JsonSchema;
}
